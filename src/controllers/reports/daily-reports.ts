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

export const getDailyReportPDF = async (req: Request, res: Response): Promise<void> => {
    const dateStr = (req.query.date as string) ?? dayjs().format("YYYY-MM-DD");
    const startOfDay = dayjs(dateStr).startOf("day").toDate();
    const endOfDay = dayjs(dateStr).endOf("day").toDate();

    try {
        const [
            sales,
            purchases,
            expenses,
            recurringExpenses,
            salarySlips,
            customerPayments,
            supplierPayments,
        ] = await Promise.all([
            prisma.sale.findMany({
                where: { createdAt: { gte: startOfDay, lte: endOfDay } },
                include: {
                    customer: { select: { name: true } },
                    items: { select: { quantity: true, avgCostPrice: true, totalPrice: true, discount: true } },
                    payments: { include: { account: { select: { name: true } } } },
                },
                orderBy: { createdAt: "asc" },
            }),
            prisma.purchase.findMany({
                where: { date: { gte: startOfDay, lte: endOfDay } },
                include: {
                    supplier: { select: { name: true } },
                    items: { select: { quantity: true, unitCost: true, totalCost: true } },
                    payments: { include: { account: { select: { name: true } } } },
                },
                orderBy: { date: "asc" },
            }),
            prisma.expense.findMany({
                where: { date: { gte: startOfDay, lte: endOfDay } },
                include: { account: { select: { name: true } } },
                orderBy: { date: "asc" },
            }),
            prisma.recurringExpense.findMany({ where: { active: true } }),
            prisma.salarySlip.findMany({
                where: { paidDate: { gte: startOfDay, lte: endOfDay } },
                include: { employee: { select: { name: true } } },
                orderBy: { paidDate: "asc" },
            }),
            prisma.customerPayment.findMany({
                where: { date: { gte: startOfDay, lte: endOfDay } },
                include: { customer: { select: { name: true } }, account: { select: { name: true } } },
                orderBy: { date: "asc" },
            }),
            prisma.supplierPayment.findMany({
                where: { date: { gte: startOfDay, lte: endOfDay } },
                include: { supplier: { select: { name: true } }, account: { select: { name: true } } },
                orderBy: { date: "asc" },
            }),
        ]);

        // ── Aggregates ──
        const totalRevenue = sales.reduce((s, x) => s + x.totalAmount, 0);
        const totalDiscount = sales.reduce((s, x) => s + x.discount + x.items.reduce((is, item) => is + (item.discount || 0) * item.quantity, 0), 0);
        const totalTax = sales.reduce((s, x) => s + x.taxAmount, 0);
        const totalCOGS = sales.reduce((s, x) =>
            s + x.items.reduce((is, item) => is + item.avgCostPrice * item.quantity, 0), 0);
        const totalSalesPaid = sales.reduce((s, x) => s + x.paidAmount, 0);
        // const totalSalesDue = totalRevenue - totalSalesPaid;
        const grossProfit = totalRevenue - totalCOGS;

        const totalPurchases = purchases.reduce((s, x) => s + x.totalAmount, 0);
        const totalPurchasesPaid = purchases.reduce((s, x) => s + x.paidAmount, 0);

        const totalExpenses = expenses.reduce((s, x) => s + x.amount, 0);
        const totalSalaries = salarySlips.reduce((s, x) => s + x.netPayable, 0);
        const totalCustPayments = customerPayments.reduce((s, x) => s + x.amount, 0);
        const totalSuppPayments = supplierPayments.reduce((s, x) => s + x.amount, 0);
        const dailyRecurringExpenses = recurringExpenses.reduce((s, x) => s + (x.frequency == 'MONTHLY' ? x.amount / 30 : x.amount), 0);
        const netProfit = grossProfit - totalExpenses - totalSalaries;

        const salesCount = sales.filter(s => s.totalAmount >= 0).length;
        const dailyQr = await generateQRBuffer(`Daily Report | ${fmtDate(dateStr)} | Sales: ${salesCount} | Purchases: ${purchases.length}`);
        const pdfGen = createPDFGenerator(pdfConfig(
            "Daily Report",
            `Summary for ${fmtDate(dateStr)}`,
            {
                "Date": fmtDate(dateStr),
                "Sales": salesCount,
                "Purchases": purchases.length,
                "Expenses": expenses.length,
            },
            "portrait",
            undefined,
            dailyQr
        ));
        const doc = pdfGen.getDocument();

        const sectionHeader = (title: string, color = "#1e293b") => {
            doc.x = doc.page.margins.left;
            doc.fontSize(11).fillColor(color).text(title);
            doc.moveDown(0.3);
        };

        // ── P&L Summary Table ──
        sectionHeader("Daily P&L Summary", "#1e40af");
        doc.x = doc.page.margins.left;
        doc.fontSize(8);
        const summaryTable = doc.table({
            columnStyles: ["*", "*"],
            rowStyles: (row: number) => {
                if (row === 0) return { backgroundColor: "#dbeafe", fontSize: 10, fontStyle: "bold" };
                if (row % 2 === 0) return { backgroundColor: "#f8fafc" };
                return {};
            },
        });
        [
            ["Metric", "Amount (Rs)"],
            [`Sales Revenue (${sales.filter(s => s.totalAmount >= 0).length} invoices)`, fmtCurrency(totalRevenue)],
            [`  Discount Given`, fmtCurrency(totalDiscount)],
            [`  Tax Collected`, fmtCurrency(totalTax)],
            [`  COGS`, fmtCurrency(totalCOGS)],
            [`  Gross Profit`, fmtCurrency(grossProfit)],
            [`Purchases (${purchases.length} orders)`, fmtCurrency(totalPurchases)],
            [`Expenses (${expenses.length})`, fmtCurrency(totalExpenses)],
            [`Recurring Expenses (Daily)`, fmtCurrency(dailyRecurringExpenses)],
            [`Salaries Paid (${salarySlips.length})`, fmtCurrency(totalSalaries)],
            [`Customer Payments Received`, fmtCurrency(totalCustPayments)],
            [`Supplier Payments Made`, fmtCurrency(totalSuppPayments)],
            [`Net Profit`, fmtCurrency(netProfit)],
        ].forEach((row, i) => {
            summaryTable.row([
                { text: row[0], align: { x: "left", y: "center" } },
                { text: i === 0 ? row[1] : row[1], align: { x: "right", y: "center" } },
            ]);
        });
        summaryTable.end();
        pdfGen.moveDown(0.8);

        // ── Sales table ──
        // if (sales.length > 0) {
        //     sectionHeader(`Sales (${sales.length})`, "#166534");
        //     doc.x = doc.page.margins.left;
        //     const t = doc.table({
        //         columnStyles: [30, 70, "*", 70, 70, 70, 60],
        //         rowStyles: (row: number) => row === 0 ? { backgroundColor: "#dcfce7", fontStyle: "bold", fontSize: 9 } : {},
        //     });
        //     t.row(["#", "Time", "Customer", "Discount", "Tax", "Total", "Paid"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
        //     sales.forEach((s, i) => {
        //         t.row([
        //             { text: String(i + 1), align: { x: "center", y: "center" } },
        //             { text: fmtDate(s.createdAt, "hh:mm A"), align: { x: "center", y: "center" } },
        //             { text: s.customer?.name ?? "Walk-in", align: { x: "left", y: "center" } },
        //             { text: fmtCurrency(s.discount), align: { x: "right", y: "center" } },
        //             { text: fmtCurrency(s.taxAmount), align: { x: "right", y: "center" } },
        //             { text: fmtCurrency(s.totalAmount), align: { x: "right", y: "center" } },
        //             { text: fmtCurrency(s.paidAmount), align: { x: "right", y: "center" } },
        //         ]);
        //     });
        //     t.row([
        //         { text: "Total", colSpan: 3, align: { x: "right", y: "center" } },
        //         { text: fmtCurrency(totalDiscount), align: { x: "right", y: "center" } },
        //         { text: fmtCurrency(totalTax), align: { x: "right", y: "center" } },
        //         { text: fmtCurrency(totalRevenue), align: { x: "right", y: "center" } },
        //         { text: fmtCurrency(totalSalesPaid), align: { x: "right", y: "center" } },
        //     ]);
        //     t.end();
        //     pdfGen.moveDown(0.8);
        // }

        // ── Purchases table ──
        if (purchases.length > 0) {
            sectionHeader(`Purchases (${purchases.length})`, "#1e3a8a");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 70, "*", 80, 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#dbeafe", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Supplier", "Total", "Paid"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            purchases.forEach((p, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(p.date, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: p.supplier?.name ?? "N/A", align: { x: "left", y: "center" } },
                    { text: fmtCurrency(p.totalAmount), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(p.paidAmount), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 3, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalPurchases), align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalPurchasesPaid), align: { x: "right", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.8);
        }

        // ── Expenses table ──
        if (expenses.length > 0) {
            sectionHeader(`Expenses (${expenses.length})`, "#7c2d12");
            doc.fontSize(8);
            doc.x = doc.page.margins.left;
            const t = doc.table({
                columnStyles: [30, 70, "*", "*", 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#fee2e2", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Description", "Category", "Amount"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            expenses.forEach((ex, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(ex.date, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: ex.description, align: { x: "left", y: "center" } },
                    { text: ex.category, align: { x: "left", y: "center" } },
                    { text: fmtCurrency(ex.amount), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 4, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalExpenses), align: { x: "right", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.8);
        }

        // ── Salaries table ──
        if (salarySlips.length > 0) {
            sectionHeader(`Salaries Paid (${salarySlips.length})`, "#5b21b6");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, "*", 70, 70, 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ede9fe", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Employee", "Month/Year", "Advances", "Net Paid"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            salarySlips.forEach((sl, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: sl.employee.name, align: { x: "left", y: "center" } },
                    { text: `${sl.month}/${sl.year}`, align: { x: "center", y: "center" } },
                    { text: fmtCurrency(sl.totalAdvances), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(sl.netPayable), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 4, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalSalaries), align: { x: "right", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.8);
        }

        // ── Customer payments ──
        if (customerPayments.length > 0) {
            sectionHeader(`Customer Payments Received (${customerPayments.length})`, "#0f766e");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 70, "*", "*", 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ccfbf1", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Customer", "Account", "Amount"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            customerPayments.forEach((cp, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(cp.date, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: cp.customer.name, align: { x: "left", y: "center" } },
                    { text: cp.account.name, align: { x: "left", y: "center" } },
                    { text: fmtCurrency(cp.amount), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 4, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalCustPayments), align: { x: "right", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.8);
        }

        // ── Supplier payments ──
        if (supplierPayments.length > 0) {
            sectionHeader(`Supplier Payments Made (${supplierPayments.length})`, "#9a3412");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 70, "*", "*", 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ffedd5", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Supplier", "Account", "Amount"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            supplierPayments.forEach((sp, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(sp.date, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: sp.supplier.name, align: { x: "left", y: "center" } },
                    { text: sp.account.name, align: { x: "left", y: "center" } },
                    { text: fmtCurrency(sp.amount), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 4, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalSuppPayments), align: { x: "right", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.8);
        }

        // ── Recurring Expenses note ──
        if (recurringExpenses.length > 0) {
            sectionHeader(`Active Recurring Expenses (${recurringExpenses.length})`, "#92400e");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: ["*", "*", "*", 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#fef3c7", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["Name", "Category", "Frequency", "Amount (Rs)"].map(h => ({ text: h, align: { x: "left", y: "center" } })));
            recurringExpenses.forEach(re => {
                t.row([
                    { text: re.name, align: { x: "left", y: "center" } },
                    { text: re.category, align: { x: "left", y: "center" } },
                    { text: re.frequency, align: { x: "left", y: "center" } },
                    { text: fmtCurrency(re.amount), align: { x: "right", y: "center" } },
                ]);
            });
            t.end();
            pdfGen.moveDown(0.8);
        }

        generateSignatureSection(doc, {
            signatures: [
                { label: "Prepared By", name: "_________________", title: "Cashier" },
                { label: "Reviewed By", name: "_________________", title: "Manager" },
                { label: "Approved By", name: "_________________", title: "Owner" },
            ],
            spacing: 30,
            lineWidth: 120,
            labelFont: { family: "Helvetica-Bold", size: 8 },
            nameFont: { size: 9 },
        });

        await pdfGen.sendToResponse(res, `daily-report-${dateStr}.pdf`);
    } catch (error) {
        console.error("Daily report PDF error:", error);
        res.status(500).json({ error: "Failed to generate daily report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
