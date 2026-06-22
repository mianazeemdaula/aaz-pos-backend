import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import { generateSignatureSection } from "../../utils/pdf/pdfkit-components";
import {
    fmtDate,
    fmtCurrency,
    pdfConfig,
    generateQRBuffer,
    createPDFGenerator
} from "./helpers";
import { computeSupplierBalance } from "../../utils/balance";

export const getPurchasesReportPDF = async (req: Request, res: Response): Promise<void> => {
    const { from, to } = req.query;
    const where: any = {};
    if (from) where.date = { ...where.date, gte: new Date(`${from}T00:00:00.000`) };
    if (to) where.date = { ...where.date, lte: new Date(`${to}T23:59:59.999`) };

    try {
        const purchases = await prisma.purchase.findMany({
            where,
            orderBy: { date: "desc" },
            include: {
                supplier: { select: { name: true } },
                items: { select: { quantity: true, totalCost: true } },
            },
        });

        const totalCost = purchases.reduce((s, p) => s + p.totalAmount, 0);
        const totalPaid = purchases.reduce((s, p) => s + p.paidAmount, 0);
        const totalDue = totalCost - totalPaid;
        const totalDiscount = purchases.reduce((s, p) => s + p.discount, 0);
        const totalTax = purchases.reduce((s, p) => s + p.taxAmount, 0);

        const rows = purchases.map((p, i) => ({
            sno: i + 1,
            date: p.date,
            supplier: p.supplier?.name ?? "N/A",
            invoiceNo: p.invoiceNo ?? "N/A",
            itemsCount: p.items.length,
            discount: p.discount,
            tax: p.taxAmount,
            total: p.totalAmount,
            paid: p.paidAmount,
            due: p.totalAmount - p.paidAmount,
        }));

        const purchQr = await generateQRBuffer(`Purchases Report | ${from ? fmtDate(from as string) : "All"} - ${to ? fmtDate(to as string) : "Now"} | Orders: ${purchases.length}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Purchases Report", "Purchase Order Summary", {
                "From": from ? fmtDate(from as string) : "All Time",
                "To": to ? fmtDate(to as string) : "Now",
                "Total Orders": purchases.length,
            }, "landscape", "A4", purchQr)
        );
        const doc = pdfGen.getDocument();

        // Summary
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Cost", align: { x: "left", y: "center" } },
            { text: "Total Discount", align: { x: "left", y: "center" } },
            { text: "Total Tax", align: { x: "left", y: "center" } },
            { text: "Total Due", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: fmtCurrency(totalCost), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDiscount), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalTax), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDue), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();

        pdfGen.moveDown(0.5);

        // Purchases table — 10 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, 80, "*", 80, 50, 70, 70, 80, 80, 80],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Supplier", align: { x: "left", y: "center" } },
            { text: "Invoice No.", align: { x: "center", y: "center" } },
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
                { text: fmtDate(row.date, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: row.supplier, align: { x: "left", y: "center" } },
                { text: row.invoiceNo, align: { x: "center", y: "center" } },
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
            { text: fmtCurrency(totalCost), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalPaid), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalDue), align: { x: "right", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `purchases-report-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Purchases report PDF error:", error);
        res.status(500).json({ error: "Failed to generate purchases report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

export const getSupplierBusinessReportPDF = async (req: Request, res: Response): Promise<void> => {
    try {
        const supplierId = parseInt(req.params.supplierId);
        if (isNaN(supplierId)) { res.status(400).json({ error: "Invalid supplier ID" }); return; }

        const from = req.query.from ? dayjs(req.query.from as string).startOf("day").toDate() : dayjs().subtract(1, "month").startOf("month").toDate();
        const to = req.query.to ? dayjs(req.query.to as string).endOf("day").toDate() : dayjs().endOf("day").toDate();

        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

        // Fetch all purchases from this supplier in date range
        const purchases = await prisma.purchase.findMany({
            where: { supplierId, date: { gte: from, lte: to } },
            include: { items: { include: { product: true } } },
            orderBy: { date: "desc" },
        });

        // Fetch purchase returns (returns have negative totalAmount)
        const returns = purchases.filter(p => p.totalAmount < 0);
        const regularPurchases = purchases.filter(p => p.totalAmount >= 0);

        // Fetch payments in date range
        const payments = await prisma.supplierPayment.findMany({
            where: { supplierId, date: { gte: from, lte: to } },
            include: { account: true },
            orderBy: { date: "desc" },
        });

        const totalPurchases = regularPurchases.reduce((s, p) => s + p.totalAmount, 0);
        const totalPaid = regularPurchases.reduce((s, p) => s + p.paidAmount, 0);
        const totalReturns = returns.reduce((s, p) => s + p.totalAmount, 0);
        const totalPayments = payments.reduce((s, p) => s + p.amount, 0);
        const totalItems = regularPurchases.reduce((s, p) => s + (p.items?.length ?? 0), 0);
        const netBusiness = totalPurchases - totalReturns;

        const qr = await generateQRBuffer(`Supplier Business: ${supplier.name} | ${fmtDate(from)} - ${fmtDate(to)} | Net: ${fmtCurrency(netBusiness)}`);
        const pdfGen = createPDFGenerator(
            pdfConfig(
                "Supplier Business Report",
                `${supplier.name} — ${fmtDate(from)} to ${fmtDate(to)}`,
                {
                    "Supplier": supplier.name,
                    "Phone": supplier.phone ?? "N/A",
                    "Period": `${fmtDate(from)} — ${fmtDate(to)}`,
                },
                "portrait", "A4", qr
            )
        );
        const doc = pdfGen.getDocument();

        // Summary table
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Purchases", align: { x: "left", y: "center" } },
            { text: "Total Returns", align: { x: "left", y: "center" } },
            { text: "Net Business", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: `Rs ${fmtCurrency(totalPurchases)}`, align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(totalReturns)}`, align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(netBusiness)}`, align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: "Total Paid (on purchases)", align: { x: "left", y: "center" } },
            { text: "Standalone Payments", align: { x: "left", y: "center" } },
            { text: "Current Balance", align: { x: "left", y: "center" } },
        ]);
        const currentBalance = await computeSupplierBalance(supplierId);

        summaryTable.row([
            { text: `Rs ${fmtCurrency(totalPaid)}`, align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(totalPayments)}`, align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(currentBalance)}`, align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();
        pdfGen.moveDown(0.5);

        // Purchases table
        if (regularPurchases.length > 0) {
            doc.fontSize(11).font("Helvetica-Bold").fillColor("#1e3a8a").text(`Purchases (${regularPurchases.length})`, doc.page.margins.left);
            doc.moveDown(0.3);
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 60, 75, 75, 75, 75, 60],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#dbeafe", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "PO #", "Date", "Total", "Paid", "Due", "Items"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            regularPurchases.forEach((p, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: p.invoiceNo ?? `PO-${p.id}`, align: { x: "center", y: "center" } },
                    { text: fmtDate(p.date), align: { x: "center", y: "center" } },
                    { text: fmtCurrency(p.totalAmount), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(p.paidAmount), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(Math.max(0, p.totalAmount - p.paidAmount)), align: { x: "right", y: "center" } },
                    { text: String(p.items?.length ?? 0), align: { x: "center", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 3, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalPurchases), align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalPaid), align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalPurchases - totalPaid), align: { x: "right", y: "center" } },
                { text: String(totalItems), align: { x: "center", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.5);
        }

        // Returns table
        if (returns.length > 0) {
            doc.fontSize(11).font("Helvetica-Bold").fillColor("#9a3412").text(`Returns (${returns.length})`, doc.page.margins.left);
            doc.moveDown(0.3);
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 75, 75, 75, 60],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ffedd5", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Date", "Amount", "Items", "Invoice"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            returns.forEach((r, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(r.date), align: { x: "center", y: "center" } },
                    { text: fmtCurrency(r.totalAmount), align: { x: "right", y: "center" } },
                    { text: String(r.items?.length ?? 0), align: { x: "center", y: "center" } },
                    { text: r.invoiceNo ?? `PRTN-${r.id}`, align: { x: "center", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total Returns", colSpan: 2, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalReturns), align: { x: "right", y: "center" } },
                { text: "", align: { x: "center", y: "center" } },
                { text: "", align: { x: "center", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.5);
        }

        // Payments table
        if (payments.length > 0) {
            doc.fontSize(11).font("Helvetica-Bold").fillColor("#0f766e").text(`Payments (${payments.length})`, doc.page.margins.left);
            doc.moveDown(0.3);
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 75, "*", 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ccfbf1", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Date", "Account", "Amount"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            payments.forEach((p, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(p.date), align: { x: "center", y: "center" } },
                    { text: p.account?.name ?? "N/A", align: { x: "left", y: "center" } },
                    { text: fmtCurrency(p.amount), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total Payments", colSpan: 3, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalPayments), align: { x: "right", y: "center" } },
            ]);
            t.end();
        }

        generateSignatureSection(doc, {
            signatures: [
                { label: "Prepared By", name: "_________________", title: "Accountant" },
                { label: "Approved By", name: "_________________", title: "Manager" },
            ],
            spacing: 30,
            lineWidth: 120,
            labelFont: { family: "Helvetica-Bold", size: 8 },
            nameFont: { size: 9 },
        });

        await pdfGen.sendToResponse(res, `supplier-business-${supplier.name.replace(/\s+/g, "-")}-${dayjs(from).format("YYYY-MM-DD")}-${dayjs(to).format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Supplier business report PDF error:", error);
        res.status(500).json({ error: "Failed to generate supplier business report", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

export const getSupplierDetailedPurchasesReportPDF = async (req: Request, res: Response): Promise<void> => {
    const { from, to, supplierId } = req.query;
    const where: any = {};
    if (from) where.date = { ...where.date, gte: new Date(`${from}T00:00:00.000`) };
    if (to) where.date = { ...where.date, lte: new Date(`${to}T23:59:59.999`) };
    if (supplierId) {
        where.supplierId = parseInt(supplierId as string);
    }

    try {
        const purchases = await prisma.purchase.findMany({
            where,
            orderBy: { date: "desc" },
            include: {
                supplier: { select: { name: true } },
                items: {
                    include: {
                        product: { select: { name: true } }
                    }
                },
            },
        });

        const totalCost = purchases.reduce((s, p) => s + p.totalAmount, 0);
        const totalPaid = purchases.reduce((s, p) => s + p.paidAmount, 0);
        const totalDue = totalCost - totalPaid;
        const totalDiscount = purchases.reduce((s, p) => s + p.discount, 0);
        const totalTax = purchases.reduce((s, p) => s + p.taxAmount, 0);

        const rows = purchases.map((p, i) => {
            const itemLines = p.items.map(item => {
                const name = item.product?.name || "Product";
                return `${name} - ${item.quantity} x ${item.unitCost}`;
            }).join("\n");

            return {
                sno: i + 1,
                date: p.date,
                supplier: p.supplier?.name ?? "N/A",
                invoiceNo: p.invoiceNo ?? `PO-${p.id}`,
                itemDetails: itemLines || "No items",
                discount: p.discount,
                tax: p.taxAmount,
                total: p.totalAmount,
                paid: p.paidAmount,
                due: p.totalAmount - p.paidAmount,
            };
        });

        let supName = "All";
        if (supplierId) {
            const s = await prisma.supplier.findUnique({ where: { id: parseInt(supplierId as string) }, select: { name: true } });
            if (s) supName = s.name;
        }

        const purchQr = await generateQRBuffer(`Detailed Purchases Report | Supplier: ${supName} | Orders: ${purchases.length}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Detailed Purchases Report", "Detailed Supplier Purchases Summary", {
                "From": from ? fmtDate(from as string) : "All Time",
                "To": to ? fmtDate(to as string) : "Now",
                "Supplier": supName,
                "Total Orders": purchases.length,
            }, "landscape", "A4", purchQr)
        );
        const doc = pdfGen.getDocument();

        // Summary
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Cost", align: { x: "left", y: "center" } },
            { text: "Total Discount", align: { x: "left", y: "center" } },
            { text: "Total Tax", align: { x: "left", y: "center" } },
            { text: "Total Due", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: fmtCurrency(totalCost), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDiscount), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalTax), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDue), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();

        pdfGen.moveDown(0.5);

        // Purchases table — 10 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [20, 80, 70, 100, 250, 50, 40, 60, 60, 70],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 9, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Invoice No.", align: { x: "center", y: "center" } },
            { text: "Supplier", align: { x: "left", y: "center" } },
            { text: "Item Details (Product - Qty x Cost)", align: { x: "left", y: "center" } },
            { text: "Discount", align: { x: "right", y: "center" } },
            { text: "Tax", align: { x: "right", y: "center" } },
            { text: "Total", align: { x: "right", y: "center" } },
            { text: "Paid", align: { x: "right", y: "center" } },
            { text: "Due", align: { x: "right", y: "center" } },
        ]);
        rows.forEach((row) => {
            table.row([
                { text: String(row.sno), align: { x: "center", y: "center" } },
                { text: fmtDate(row.date, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: row.invoiceNo, align: { x: "center", y: "center" } },
                { text: row.supplier, align: { x: "left", y: "center" } },
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
            { text: "Grand Total", colSpan: 5, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDiscount), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalTax), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalCost), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalPaid), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalDue), align: { x: "right", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `detailed-purchases-report-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Detailed purchases report PDF error:", error);
        res.status(500).json({ error: "Failed to generate detailed purchases report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
