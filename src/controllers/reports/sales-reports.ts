import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import {
    fmtDate,
    fmtCurrency,
    pdfConfig,
    fonts,
    generateQRBuffer,
    createPDFGenerator,
    readSettings
} from "./helpers";

export const getSalesReportPDF = async (req: Request, res: Response): Promise<void> => {
    const { from, to, userId } = req.query;
    const where: any = {};
    if (from) where.createdAt = { ...where.createdAt, gte: new Date(`${from}T00:00:00.000`) };
    if (to) where.createdAt = { ...where.createdAt, lte: new Date(`${to}T23:59:59.999`) };
    if (userId) {
        where.userId = parseInt(userId as string);
    }

    try {
        const sales = await prisma.sale.findMany({
            where,
            orderBy: { createdAt: "desc" },
            include: {
                customer: { select: { name: true } },
                user: { select: { name: true } },
                items: { select: { quantity: true, avgCostPrice: true, totalPrice: true, discount: true } },
                payments: { include: { account: { select: { name: true } } } },
            },
        });

        const totalRevenue = sales.reduce((s, sale) => s + sale.totalAmount, 0);
        const totalDiscount = sales.reduce((s, sale) => s + sale.discount + sale.items.reduce((is, item) => is + (item.discount || 0) * item.quantity, 0), 0);
        const totalTax = sales.reduce((s, sale) => s + sale.taxAmount, 0);
        const totalCOGS = sales.reduce((s, sale) =>
            s + sale.items.reduce((is, item) => is + item.avgCostPrice * item.quantity, 0), 0);
        const grossProfit = totalRevenue - totalCOGS;
        const totalPaid = sales.reduce((s, sale) => s + sale.paidAmount, 0);
        const totalDue = sales.reduce((s, sale) => s + (sale.totalAmount - sale.paidAmount), 0);

        const rows = sales.map((sale, i) => ({
            sno: i + 1,
            date: sale.createdAt,
            customer: sale.customer?.name ?? "Walk-in",
            cashier: sale.user?.name ?? "N/A",
            itemsCount: sale.items.length,
            discount: sale.discount + sale.items.reduce((is, item) => is + (item.discount || 0) * item.quantity, 0),
            tax: sale.taxAmount,
            total: sale.totalAmount,
            paid: sale.paidAmount,
            due: sale.totalAmount - sale.paidAmount,
        }));

        let cashierName = "All";
        if (userId) {
            const u = await prisma.user.findUnique({ where: { id: parseInt(userId as string) }, select: { name: true } });
            if (u) cashierName = u.name;
        }

        const salesCount = sales.filter(s => s.totalAmount >= 0).length;
        const salesQr = await generateQRBuffer(`Sales Report | ${from ? fmtDate(from as string) : "All"} - ${to ? fmtDate(to as string) : "Now"} | Txns: ${salesCount}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Sales Report", "Sales Transaction Summary", {
                "From": from ? fmtDate(from as string) : "All Time",
                "To": to ? fmtDate(to as string) : "Now",
                "Cashier": cashierName,
                "Transactions": salesCount,
            }, "landscape", "A4", salesQr)
        );
        const doc = pdfGen.getDocument();

        // Summary section
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Revenue", align: { x: "left", y: "center" } },
            { text: "Total Discount", align: { x: "left", y: "center" } },
            { text: "Total Tax", align: { x: "left", y: "center" } },
            { text: "Cost of Goods", align: { x: "left", y: "center" } },
            { text: "Gross Profit", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: fmtCurrency(totalRevenue), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDiscount), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalTax), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCOGS), align: { x: "left", y: "center" } },
            { text: fmtCurrency(grossProfit), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();

        pdfGen.moveDown(0.3);

        // Calculate payment method breakdown
        const accountBreakdown: Record<string, number> = {};
        for (const sale of sales) {
            for (const p of sale.payments) {
                const accName = p.account?.name || "Cash";
                const netAmount = p.amount - (p.changeAmount || 0);
                accountBreakdown[accName] = (accountBreakdown[accName] || 0) + netAmount;
            }
        }
        if (!accountBreakdown["Cash"] && !accountBreakdown["cash"]) {
            accountBreakdown["Cash"] = 0;
        }

        // Payment Breakdown section for Shift Closing
        doc.x = doc.page.margins.left;
        doc.fontSize(10).font("Helvetica-Bold").text("Payment Method Breakdown (Reconciliation)", { underline: true });
        pdfGen.moveDown(0.2);
        doc.font('Helvetica').fontSize(9);

        const paymentTable = doc.table({
            columnStyles: [200, 150],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f8fafc", fontSize: 9, fontStyle: "bold" } : {},
        });
        paymentTable.row([
            { text: "Payment Account / Method", align: { x: "left", y: "center" } },
            { text: "Net Amount Collected", align: { x: "right", y: "center" } },
        ]);
        Object.entries(accountBreakdown).forEach(([accName, amount]) => {
            paymentTable.row([
                { text: accName, align: { x: "left", y: "center" } },
                { text: fmtCurrency(amount), align: { x: "right", y: "center" } },
            ]);
        });
        paymentTable.end();

        pdfGen.moveDown(0.5);

        // Main transactions table — 10 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, 100, '*', 80, 40, 60, 60, 70, 70, 70],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Customer", align: { x: "left", y: "center" } },
            { text: "Cashier", align: { x: "left", y: "center" } },
            { text: "Items", align: { x: "center", y: "center" } },
            { text: "Discount", align: { x: "right", y: "center" } },
            { text: "Tax", align: { x: "right", y: "center" } },
            { text: "Total", align: { x: "right", y: "center" } },
            { text: "Paid", align: { x: "right", y: "center" } },
            { text: "Due", align: { x: "right", y: "center" } },
        ]);
        rows.forEach((row) => {
            table.row([
                { text: String(row.sno), align: { x: "center", y: "center" } },
                { text: fmtDate(row.date, "DD-MM-YYYY hh:mm A"), align: { x: "center", y: "center" } },
                { text: row.customer, align: { x: "left", y: "center" } },
                { text: row.cashier, align: { x: "left", y: "center" } },
                { text: String(row.itemsCount), align: { x: "center", y: "center" } },
                { text: fmtCurrency(row.discount), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.tax), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.total), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.paid), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.due), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Grand Total", colSpan: 5, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDiscount), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalTax), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalRevenue), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalPaid), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalDue), align: { x: "right", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `sales-report-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Sales report PDF error:", error);
        res.status(500).json({ error: "Failed to generate sales report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

export const getCashierSalesReportPDF = async (req: Request, res: Response): Promise<void> => {
    const { from, to, userId } = req.query;
    const where: any = {};
    if (from) where.createdAt = { ...where.createdAt, gte: new Date(`${from}T00:00:00.000`) };
    if (to) where.createdAt = { ...where.createdAt, lte: new Date(`${to}T23:59:59.999`) };
    if (userId) {
        where.userId = parseInt(userId as string);
    }

    try {
        const sales = await prisma.sale.findMany({
            where,
            include: {
                user: { select: { id: true, name: true, role: true } },
                items: { select: { quantity: true, avgCostPrice: true, totalPrice: true, discount: true } },
                payments: { include: { account: { select: { name: true } } } },
            },
        });

        // Group sales by user
        const cashierMap = new Map<number, {
            name: string;
            role: string;
            salesCount: number;
            totalRevenue: number;
            totalCOGS: number;
            totalDiscount: number;
            grossProfit: number;
            payments: Record<string, number>;
        }>();

        for (const sale of sales) {
            const uId = sale.userId || 0; // 0 for Unassigned/Deleted
            const uName = sale.user?.name || "System/Unknown";
            const uRole = sale.user?.role || "SYSTEM";

            if (!cashierMap.has(uId)) {
                cashierMap.set(uId, {
                    name: uName,
                    role: uRole,
                    salesCount: 0,
                    totalRevenue: 0,
                    totalCOGS: 0,
                    totalDiscount: 0,
                    grossProfit: 0,
                    payments: {},
                });
            }

            const data = cashierMap.get(uId)!;
            if (sale.totalAmount >= 0) {
                data.salesCount += 1;
            }
            data.totalRevenue += sale.totalAmount;
            data.totalDiscount += sale.discount + sale.items.reduce((is, item) => is + (item.discount || 0) * item.quantity, 0);

            // COGS
            const cogs = sale.items.reduce((s, item) => s + (item.avgCostPrice ?? 0) * item.quantity, 0);
            data.totalCOGS += cogs;

            // Payments breakdown
            for (const p of sale.payments) {
                const accName = p.account?.name || "Cash";
                const netAmount = p.amount - (p.changeAmount || 0);
                data.payments[accName] = (data.payments[accName] || 0) + netAmount;
            }
        }

        // Calculate gross profit for each cashier
        for (const data of cashierMap.values()) {
            data.grossProfit = data.totalRevenue - data.totalCOGS;
        }

        const list = Array.from(cashierMap.values());

        const reportFonts = fonts();
        const company = readSettings();
        const pdfGen = createPDFGenerator({
            fontRegistrations: reportFonts.registrations,
            fontFamilyMap: reportFonts.aliasMap,
            pdfOptions: {
                size: "A4",
                margins: { top: 15, bottom: 15, left: 20, right: 20 },
            },
            header: {
                title: "Cashier Sales Summary Report",
                subtitle: "Drawer Closing and Shift Reconciliation Summary",
                companyName: (company.businessName as string) || undefined,
                address: (company.address as string) || undefined,
                phone: (company.phone as string) || undefined,
                showDate: true,
                titleFont: { family: "Helvetica-Bold" as const, size: 14, color: "#1e40af" },
                subtitleFont: { size: 9, color: "#475569" },
                filterInfo: {
                    "From": from ? fmtDate(from as string) : "All Time",
                    "To": to ? fmtDate(to as string) : "Now",
                    "Cashiers": list.length,
                },
            },
            footer: {
                leftText: (company.businessName as string) || "POS System",
                centerText: "Cashier Shift Closing Report",
                showPageNumber: true,
                font: { size: 8, color: "#666666" },
            },
        });

        const doc = pdfGen.getDocument();
        doc.x = doc.page.margins.left;

        if (list.length === 0) {
            doc.fontSize(12).text("No transactions found for the selected period.", { align: "center" });
        } else {
            for (const c of list) {
                // Section header for cashier
                doc.fontSize(10).font("Helvetica-Bold").fillColor("#1e40af").text(`${c.name} (${c.role})`);
                pdfGen.moveDown(0.3);
                doc.font('Helvetica').fontSize(9);

                // Summary table
                const sumTable = doc.table({
                    columnStyles: [110, 110, 110, 110, 110],
                    rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f8fafc", fontSize: 9, fontStyle: "bold" } : {},
                });
                sumTable.row([
                    { text: "Sales Count", align: { x: "left", y: "center" } },
                    { text: "Total Revenue", align: { x: "right", y: "center" } },
                    { text: "Total Discounts", align: { x: "right", y: "center" } },
                    { text: "Total COGS", align: { x: "right", y: "center" } },
                    { text: "Gross Profit", align: { x: "right", y: "center" } },
                ]);
                sumTable.row([
                    { text: String(c.salesCount), align: { x: "left", y: "center" } },
                    { text: fmtCurrency(c.totalRevenue), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(c.totalDiscount), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(c.totalCOGS), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(c.grossProfit), align: { x: "right", y: "center" } },
                ]);
                sumTable.end();

                pdfGen.moveDown(0.2);

                // Payments breakdown sub-table
                doc.fontSize(9).font("Helvetica-Bold").fillColor("#475569").text("Payment Accounts Breakdown:");
                pdfGen.moveDown(0.15);
                doc.font('Helvetica').fontSize(9);

                const payTable = doc.table({
                    columnStyles: [150, 120],
                    rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f1f5f9", fontSize: 8, fontStyle: "bold" } : {},
                });
                payTable.row([
                    { text: "Payment Account", align: { x: "left", y: "center" } },
                    { text: "Net Collected", align: { x: "right", y: "center" } },
                ]);

                // Always ensure Cash is listed
                if (!c.payments["Cash"] && !c.payments["cash"]) {
                    c.payments["Cash"] = 0;
                }

                Object.entries(c.payments).forEach(([accName, amount]) => {
                    payTable.row([
                        { text: accName, align: { x: "left", y: "center" } },
                        { text: fmtCurrency(amount), align: { x: "right", y: "center" } },
                    ]);
                });
                payTable.end();

                // Draw a separator line between cashiers
                pdfGen.moveDown(1.0);
                const currentY = doc.y;
                if (currentY < doc.page.height - doc.page.margins.bottom - 50) {
                    doc.moveTo(doc.page.margins.left, currentY)
                        .lineTo(doc.page.width - doc.page.margins.right, currentY)
                        .strokeColor("#e2e8f0")
                        .lineWidth(0.5)
                        .stroke();
                    pdfGen.moveDown(0.8);
                } else {
                    doc.addPage();
                }
            }
        }

        await pdfGen.sendToResponse(res, `cashier-sales-report-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Cashier sales report PDF error:", error);
        res.status(500).json({ error: "Failed to generate cashier sales report", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

export const getCustomerDetailedSalesReportPDF = async (req: Request, res: Response): Promise<void> => {
    const { from, to, customerId } = req.query;
    const where: any = {};
    if (from) where.createdAt = { ...where.createdAt, gte: new Date(`${from}T00:00:00.000`) };
    if (to) where.createdAt = { ...where.createdAt, lte: new Date(`${to}T23:59:59.999`) };
    if (customerId) {
        where.customerId = parseInt(customerId as string);
    }

    try {
        const sales = await prisma.sale.findMany({
            where,
            orderBy: { createdAt: "desc" },
            include: {
                customer: { select: { name: true } },
                user: { select: { name: true } },
                items: {
                    include: {
                        variant: {
                            include: {
                                product: { select: { name: true } }
                            }
                        }
                    }
                },
                payments: { include: { account: { select: { name: true } } } },
            },
        });

        const totalRevenue = sales.reduce((s, sale) => s + sale.totalAmount, 0);
        const totalDiscount = sales.reduce((s, sale) => s + sale.discount + sale.items.reduce((is, item) => is + (item.discount || 0) * item.quantity, 0), 0);
        const totalTax = sales.reduce((s, sale) => s + sale.taxAmount, 0);
        const totalPaid = sales.reduce((s, sale) => s + sale.paidAmount, 0);
        const totalDue = sales.reduce((s, sale) => s + (sale.totalAmount - sale.paidAmount), 0);

        const rows = sales.map((sale, i) => {
            const itemLines = sale.items.map(item => {
                const name = item.variant?.product?.name || "Product";
                const vName = item.variant?.name || "";
                return `${name}${vName ? ` (${vName})` : ""} - ${item.quantity} x ${item.unitPrice}`;
            }).join("\n");

            return {
                sno: i + 1,
                date: sale.createdAt,
                invoiceNo: sale.id ? `Sale #${sale.id}` : "N/A",
                customer: sale.customer?.name ?? "Walk-in",
                cashier: sale.user?.name ?? "N/A",
                itemDetails: itemLines || "No items",
                discount: sale.discount + sale.items.reduce((is, item) => is + (item.discount || 0) * item.quantity, 0),
                tax: sale.taxAmount,
                total: sale.totalAmount,
                paid: sale.paidAmount,
                due: sale.totalAmount - sale.paidAmount,
            };
        });

        let custName = "All";
        if (customerId) {
            const c = await prisma.customer.findUnique({ where: { id: parseInt(customerId as string) }, select: { name: true } });
            if (c) custName = c.name;
        }

        const salesCount = sales.length;
        const salesQr = await generateQRBuffer(`Detailed Sales Report | Customer: ${custName} | Txns: ${salesCount}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Detailed Sales Report", "Detailed Customer Sales Summary", {
                "From": from ? fmtDate(from as string) : "All Time",
                "To": to ? fmtDate(to as string) : "Now",
                "Customer": custName,
                "Transactions": salesCount,
            }, "landscape", "A4", salesQr)
        );
        const doc = pdfGen.getDocument();

        // Summary section
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Revenue", align: { x: "left", y: "center" } },
            { text: "Total Discount", align: { x: "left", y: "center" } },
            { text: "Total Tax", align: { x: "left", y: "center" } },
            { text: "Total Paid", align: { x: "left", y: "center" } },
            { text: "Total Due", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: fmtCurrency(totalRevenue), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDiscount), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalTax), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalPaid), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDue), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();

        pdfGen.moveDown(0.5);

        // Main transactions table — 11 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [20, 80, 50, 80, 60, 240, 50, 40, 60, 60, 60],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 9, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Inv No", align: { x: "center", y: "center" } },
            { text: "Customer", align: { x: "left", y: "center" } },
            { text: "Cashier", align: { x: "left", y: "center" } },
            { text: "Item Details (Product - Qty x Price)", align: { x: "left", y: "center" } },
            { text: "Discount", align: { x: "right", y: "center" } },
            { text: "Tax", align: { x: "right", y: "center" } },
            { text: "Total", align: { x: "right", y: "center" } },
            { text: "Paid", align: { x: "right", y: "center" } },
            { text: "Due", align: { x: "right", y: "center" } },
        ]);
        rows.forEach((row) => {
            table.row([
                { text: String(row.sno), align: { x: "center", y: "center" } },
                { text: fmtDate(row.date, "DD-MM-YYYY hh:mm A"), align: { x: "center", y: "center" } },
                { text: row.invoiceNo, align: { x: "center", y: "center" } },
                { text: row.customer, align: { x: "left", y: "center" } },
                { text: row.cashier, align: { x: "left", y: "center" } },
                { text: row.itemDetails, align: { x: "left", y: "center" } },
                { text: fmtCurrency(row.discount), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.tax), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.total), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.paid), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.due), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(8);
        table.row([
            { text: "Grand Total", colSpan: 6, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDiscount), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalTax), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalRevenue), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalPaid), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalDue), align: { x: "right", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `detailed-sales-report-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Detailed sales report PDF error:", error);
        res.status(500).json({ error: "Failed to generate detailed sales report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
