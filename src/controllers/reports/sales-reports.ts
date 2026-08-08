import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import {
    fmtDate,
    fmtCurrency,
    createReport,
    reportFilename,
    sendReport,
} from "./helpers";
import type { StatItem, TableCell } from "../../utils/pdf/report-spec";

/** Profit reads green when the business made money and red when it did not. */
function profitTone(value: number) {
    return value < 0 ? ("danger" as const) : ("success" as const);
}

function dueTone(value: number) {
    return value > 0 ? ("danger" as const) : ("muted" as const);
}

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

        let cashierName = "All";
        if (userId) {
            const u = await prisma.user.findUnique({ where: { id: parseInt(userId as string) }, select: { name: true } });
            if (u) cashierName = u.name;
        }

        const salesCount = sales.filter((s) => s.totalAmount >= 0).length;

        const report = createReport({
            title: "Sales Report",
            subtitle: "Sales transaction summary",
            filename: reportFilename("sales-report"),
            orientation: "landscape",
            filters: {
                From: from ? fmtDate(from as string) : "All Time",
                To: to ? fmtDate(to as string) : "Now",
                Cashier: cashierName,
                Transactions: salesCount,
            },
        });

        const margin = totalRevenue !== 0 ? (grossProfit / totalRevenue) * 100 : 0;

        report.stats([
            { label: "Total Revenue", value: fmtCurrency(totalRevenue), tone: "primary", note: `${salesCount} transactions` },
            { label: "Amount Collected", value: fmtCurrency(totalPaid), tone: "success" },
            { label: "Outstanding Due", value: fmtCurrency(totalDue), tone: dueTone(totalDue) },
            { label: "Discounts Given", value: fmtCurrency(totalDiscount), tone: "warning" },
            { label: "Tax Charged", value: fmtCurrency(totalTax) },
            { label: "Cost of Goods", value: fmtCurrency(totalCOGS), tone: "muted" },
            {
                label: "Gross Profit",
                value: fmtCurrency(grossProfit),
                tone: profitTone(grossProfit),
                note: `${margin.toFixed(1)}% margin`,
            },
        ]);

        // Payment method breakdown for shift closing.
        const accountBreakdown: Record<string, number> = {};
        for (const sale of sales) {
            for (const p of sale.payments) {
                const accName = p.account?.name || "Cash";
                accountBreakdown[accName] = (accountBreakdown[accName] || 0) + (p.amount - (p.changeAmount || 0));
            }
        }
        if (!accountBreakdown["Cash"] && !accountBreakdown["cash"]) {
            accountBreakdown["Cash"] = 0;
        }

        const breakdownEntries = Object.entries(accountBreakdown);
        const breakdownTotal = breakdownEntries.reduce((sum, [, amount]) => sum + amount, 0);

        report.section("Payment Method Breakdown", "Net amount collected per account, for drawer reconciliation");
        report.table({
            columns: [
                { label: "Payment Account / Method", width: 220 },
                { label: "Net Amount Collected", width: 150, align: "right" },
                { label: "", width: "*" },
            ],
            rows: breakdownEntries.map(([accName, amount]) => [accName, fmtCurrency(amount), ""]),
            totalRow: [
                { text: "Total Collected", bold: true },
                { text: fmtCurrency(breakdownTotal), align: "right", bold: true },
                "",
            ],
        });

        report.section("Transactions", `${sales.length} record(s)`);

        if (sales.length === 0) {
            report.note("No sales were recorded for the selected period.");
        } else {
            const rows: TableCell[][] = sales.map((sale, i) => {
                const discount = sale.discount + sale.items.reduce((is, item) => is + (item.discount || 0) * item.quantity, 0);
                const due = sale.totalAmount - sale.paidAmount;
                return [
                    String(i + 1),
                    fmtDate(sale.createdAt, "DD-MM-YYYY hh:mm A"),
                    sale.customer?.name ?? "Walk-in",
                    sale.user?.name ?? "N/A",
                    String(sale.items.length),
                    fmtCurrency(discount),
                    fmtCurrency(sale.taxAmount),
                    fmtCurrency(sale.totalAmount),
                    fmtCurrency(sale.paidAmount),
                    { text: fmtCurrency(due), align: "right", tone: due > 0 ? "danger" : undefined },
                ];
            });

            report.table({
                columns: [
                    { label: "#", width: 26, align: "center" },
                    { label: "Date", width: 100 },
                    { label: "Customer", width: "*" },
                    { label: "Cashier", width: 85 },
                    { label: "Items", width: 38, align: "center" },
                    { label: "Discount", width: 62, align: "right" },
                    { label: "Tax", width: 58, align: "right" },
                    { label: "Total", width: 72, align: "right" },
                    { label: "Paid", width: 72, align: "right" },
                    { label: "Due", width: 68, align: "right" },
                ],
                rows,
                totalRow: [
                    { text: "Grand Total", colSpan: 5 },
                    fmtCurrency(totalDiscount),
                    fmtCurrency(totalTax),
                    fmtCurrency(totalRevenue),
                    fmtCurrency(totalPaid),
                    fmtCurrency(totalDue),
                ],
            });
        }

        await sendReport(res, report);
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
            orderBy: { createdAt: "desc" },
            include: {
                user: { select: { id: true, name: true, role: true } },
                customer: { select: { id: true, name: true, phone: true } },
                items: { select: { quantity: true, avgCostPrice: true, totalPrice: true, discount: true } },
                payments: { include: { account: { select: { name: true } } } },
            },
        });

        interface CreditSaleItem {
            invoiceNo: string;
            date: Date;
            customerName: string;
            customerPhone: string;
            totalAmount: number;
            paidAmount: number;
            dueAmount: number;
        }

        const cashierMap = new Map<number, {
            name: string;
            role: string;
            salesCount: number;
            totalRevenue: number;
            totalCOGS: number;
            totalDiscount: number;
            grossProfit: number;
            totalCreditDue: number;
            payments: Record<string, number>;
            creditSales: CreditSaleItem[];
        }>();

        for (const sale of sales) {
            const uId = sale.userId || 0; // 0 for Unassigned/Deleted
            if (!cashierMap.has(uId)) {
                cashierMap.set(uId, {
                    name: sale.user?.name || "System/Unknown",
                    role: sale.user?.role || "SYSTEM",
                    salesCount: 0,
                    totalRevenue: 0,
                    totalCOGS: 0,
                    totalDiscount: 0,
                    grossProfit: 0,
                    totalCreditDue: 0,
                    payments: {},
                    creditSales: [],
                });
            }

            const data = cashierMap.get(uId)!;
            if (sale.totalAmount >= 0) data.salesCount += 1;
            data.totalRevenue += sale.totalAmount;
            data.totalDiscount += sale.discount + sale.items.reduce((is, item) => is + (item.discount || 0) * item.quantity, 0);
            data.totalCOGS += sale.items.reduce((s, item) => s + (item.avgCostPrice ?? 0) * item.quantity, 0);

            for (const p of sale.payments) {
                const accName = p.account?.name || "Cash";
                data.payments[accName] = (data.payments[accName] || 0) + (p.amount - (p.changeAmount || 0));
            }

            const dueAmount = sale.totalAmount - sale.paidAmount;
            if (sale.totalAmount > 0 && dueAmount > 0.001) {
                data.totalCreditDue += dueAmount;
                data.creditSales.push({
                    invoiceNo: sale.taxInvoiceId || `#${sale.id}`,
                    date: sale.createdAt,
                    customerName: sale.customer?.name || "Walk-in Customer",
                    customerPhone: sale.customer?.phone || "",
                    totalAmount: sale.totalAmount,
                    paidAmount: sale.paidAmount,
                    dueAmount,
                });
            }
        }

        for (const data of cashierMap.values()) {
            data.grossProfit = data.totalRevenue - data.totalCOGS;
        }

        const list = Array.from(cashierMap.values());

        const report = createReport({
            title: "Cashier Sales Summary",
            subtitle: "Drawer closing and shift reconciliation",
            filename: reportFilename("cashier-sales-report"),
            filters: {
                From: from ? fmtDate(from as string) : "All Time",
                To: to ? fmtDate(to as string) : "Now",
                Cashiers: list.length,
            },
        });

        if (list.length === 0) {
            report.note("No transactions found for the selected period.");
        } else {
            list.forEach((c, index) => {
                if (index > 0) report.divider();
                report.section(c.name, c.role);

                report.stats([
                    { label: "Sales Count", value: String(c.salesCount), tone: "primary" },
                    { label: "Total Revenue", value: fmtCurrency(c.totalRevenue), tone: "primary" },
                    { label: "Discounts", value: fmtCurrency(c.totalDiscount), tone: "warning" },
                    { label: "Credit / Due", value: fmtCurrency(c.totalCreditDue), tone: dueTone(c.totalCreditDue) },
                    { label: "Total COGS", value: fmtCurrency(c.totalCOGS), tone: "muted" },
                    { label: "Gross Profit", value: fmtCurrency(c.grossProfit), tone: profitTone(c.grossProfit) },
                ]);

                if (!c.payments["Cash"] && !c.payments["cash"]) {
                    c.payments["Cash"] = 0;
                }
                const payEntries = Object.entries(c.payments);

                report.table({
                    columns: [
                        { label: "Payment Account", width: 180 },
                        { label: "Net Collected", width: 120, align: "right" },
                        { label: "", width: "*" },
                    ],
                    rows: payEntries.map(([accName, amount]) => [accName, fmtCurrency(amount), ""]),
                    totalRow: [
                        { text: "Total Collected" },
                        { text: fmtCurrency(payEntries.reduce((sum, [, a]) => sum + a, 0)), align: "right" },
                        "",
                    ],
                    fontSize: 8,
                });

                if (c.creditSales.length === 0) {
                    report.note("No credit sales recorded for this cashier in the selected period.");
                } else {
                    let sumTotal = 0;
                    let sumPaid = 0;
                    let sumDue = 0;
                    const rows: TableCell[][] = c.creditSales.map((cs) => {
                        sumTotal += cs.totalAmount;
                        sumPaid += cs.paidAmount;
                        sumDue += cs.dueAmount;
                        return [
                            cs.invoiceNo,
                            dayjs(cs.date).format("DD-MM-YYYY HH:mm"),
                            cs.customerPhone ? `${cs.customerName} (${cs.customerPhone})` : cs.customerName,
                            fmtCurrency(cs.totalAmount),
                            fmtCurrency(cs.paidAmount),
                            { text: fmtCurrency(cs.dueAmount), align: "right", tone: "danger" },
                        ];
                    });

                    report.table({
                        columns: [
                            { label: "Invoice #", width: 78 },
                            { label: "Date", width: 88 },
                            { label: "Customer", width: "*" },
                            { label: "Total", width: 78, align: "right" },
                            { label: "Paid", width: 78, align: "right" },
                            { label: "Credit Due", width: 78, align: "right" },
                        ],
                        rows,
                        totalRow: [
                            { text: `${c.creditSales.length} credit sale(s)`, colSpan: 3 },
                            fmtCurrency(sumTotal),
                            fmtCurrency(sumPaid),
                            fmtCurrency(sumDue),
                        ],
                        fontSize: 8,
                    });
                }
            });
        }

        await sendReport(res, report);
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
                        variant: { include: { product: { select: { name: true } } } },
                    },
                },
            },
        });

        const totalRevenue = sales.reduce((s, sale) => s + sale.totalAmount, 0);
        const totalDiscount = sales.reduce((s, sale) => s + sale.discount + sale.items.reduce((is, item) => is + (item.discount || 0) * item.quantity, 0), 0);
        const totalTax = sales.reduce((s, sale) => s + sale.taxAmount, 0);
        const totalPaid = sales.reduce((s, sale) => s + sale.paidAmount, 0);
        const totalDue = sales.reduce((s, sale) => s + (sale.totalAmount - sale.paidAmount), 0);

        let custName = "All";
        if (customerId) {
            const c = await prisma.customer.findUnique({ where: { id: parseInt(customerId as string) }, select: { name: true } });
            if (c) custName = c.name;
        }

        const report = createReport({
            title: "Detailed Sales Report",
            subtitle: "Line-item breakdown per invoice",
            filename: reportFilename("detailed-sales-report"),
            orientation: "landscape",
            filters: {
                From: from ? fmtDate(from as string) : "All Time",
                To: to ? fmtDate(to as string) : "Now",
                Customer: custName,
                Transactions: sales.length,
            },
        });

        report.stats([
            { label: "Total Revenue", value: fmtCurrency(totalRevenue), tone: "primary", note: `${sales.length} invoices` },
            { label: "Amount Collected", value: fmtCurrency(totalPaid), tone: "success" },
            { label: "Outstanding Due", value: fmtCurrency(totalDue), tone: dueTone(totalDue) },
            { label: "Discounts Given", value: fmtCurrency(totalDiscount), tone: "warning" },
            { label: "Tax Charged", value: fmtCurrency(totalTax) },
        ]);

        report.section("Invoices", `${sales.length} record(s)`);

        if (sales.length === 0) {
            report.note("No sales were recorded for the selected period.");
        } else {
            const rows: TableCell[][] = sales.map((sale, i) => {
                const itemLines = sale.items
                    .map((item) => {
                        const name = item.variant?.product?.name || "Product";
                        const vName = item.variant?.name || "";
                        return `${name}${vName ? ` (${vName})` : ""} - ${item.quantity} x ${item.unitPrice}`;
                    })
                    .join("\n");
                const discount = sale.discount + sale.items.reduce((is, item) => is + (item.discount || 0) * item.quantity, 0);
                const due = sale.totalAmount - sale.paidAmount;

                return [
                    String(i + 1),
                    fmtDate(sale.createdAt, "DD-MM-YYYY hh:mm A"),
                    `#${sale.id}`,
                    sale.customer?.name ?? "Walk-in",
                    sale.user?.name ?? "N/A",
                    itemLines || "No items",
                    fmtCurrency(discount),
                    fmtCurrency(sale.taxAmount),
                    fmtCurrency(sale.totalAmount),
                    fmtCurrency(sale.paidAmount),
                    { text: fmtCurrency(due), align: "right", tone: due > 0 ? "danger" : undefined },
                ];
            });

            report.table({
                columns: [
                    { label: "#", width: 24, align: "center" },
                    { label: "Date", width: 92 },
                    { label: "Invoice", width: 48, align: "center" },
                    { label: "Customer", width: 78 },
                    { label: "Cashier", width: 62 },
                    { label: "Items (product · qty × price)", width: "*", wrap: true },
                    { label: "Discount", width: 56, align: "right" },
                    { label: "Tax", width: 46, align: "right" },
                    { label: "Total", width: 62, align: "right" },
                    { label: "Paid", width: 62, align: "right" },
                    { label: "Due", width: 60, align: "right" },
                ],
                rows,
                totalRow: [
                    { text: "Grand Total", colSpan: 6 },
                    fmtCurrency(totalDiscount),
                    fmtCurrency(totalTax),
                    fmtCurrency(totalRevenue),
                    fmtCurrency(totalPaid),
                    fmtCurrency(totalDue),
                ],
                fontSize: 7.5,
            });
        }

        await sendReport(res, report);
    } catch (error) {
        console.error("Detailed sales report PDF error:", error);
        res.status(500).json({ error: "Failed to generate detailed sales report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
