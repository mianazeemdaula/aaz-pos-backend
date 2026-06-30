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

// Helper to compute starting balances of active accounts prior to startOfDay
async function computeBalancesForIdsBeforeDate(accountIds: number[], beforeDate: Date): Promise<Map<number, number>> {
    if (accountIds.length === 0) return new Map();

    const [sp, cp, pp, ex, sup, sal, ea, trFrom, trTo] = await Promise.all([
        prisma.salePayment.groupBy({
            by: ["accountId"],
            where: { accountId: { in: accountIds }, createdAt: { lt: beforeDate } },
            _sum: { amount: true }
        }),
        prisma.customerPayment.groupBy({
            by: ["accountId", "type"],
            where: { accountId: { in: accountIds }, date: { lt: beforeDate } },
            _sum: { amount: true }
        }),
        prisma.purchasePayment.groupBy({
            by: ["accountId"],
            where: { accountId: { in: accountIds }, createdAt: { lt: beforeDate } },
            _sum: { amount: true }
        }),
        prisma.expense.groupBy({
            by: ["accountId"],
            where: { accountId: { in: accountIds }, date: { lt: beforeDate } },
            _sum: { amount: true }
        }),
        prisma.supplierPayment.groupBy({
            by: ["accountId", "type"],
            where: { accountId: { in: accountIds }, date: { lt: beforeDate } },
            _sum: { amount: true }
        }),
        prisma.salarySlip.groupBy({
            by: ["accountId"],
            where: { accountId: { in: accountIds }, status: "PAID", paidDate: { lt: beforeDate } },
            _sum: { netPayable: true }
        }),
        prisma.employeeAdvance.groupBy({
            by: ["accountId"],
            where: { accountId: { in: accountIds }, date: { lt: beforeDate } },
            _sum: { amount: true }
        }),
        prisma.accountTransfer.groupBy({
            by: ["fromAccountId"],
            where: { fromAccountId: { in: accountIds }, createdAt: { lt: beforeDate } },
            _sum: { amount: true }
        }),
        prisma.accountTransfer.groupBy({
            by: ["toAccountId"],
            where: { toAccountId: { in: accountIds }, createdAt: { lt: beforeDate } },
            _sum: { amount: true }
        }),
    ]);

    const balances = new Map<number, number>(accountIds.map(id => [id, 0]));

    for (const row of sp) balances.set(row.accountId, (balances.get(row.accountId) ?? 0) + (row._sum.amount ?? 0));
    for (const row of cp) {
        const val = row._sum.amount ?? 0;
        const change = row.type === "SENT" ? -val : val;
        balances.set(row.accountId, (balances.get(row.accountId) ?? 0) + change);
    }
    for (const row of pp) balances.set(row.accountId, (balances.get(row.accountId) ?? 0) - (row._sum.amount ?? 0));
    for (const row of ex) balances.set(row.accountId, (balances.get(row.accountId) ?? 0) - (row._sum.amount ?? 0));
    for (const row of sup) {
        const val = row._sum.amount ?? 0;
        const change = row.type === "RECEIVED" ? val : -val;
        balances.set(row.accountId, (balances.get(row.accountId) ?? 0) + change);
    }
    for (const row of sal) if (row.accountId != null) balances.set(row.accountId, (balances.get(row.accountId) ?? 0) - (row._sum.netPayable ?? 0));
    for (const row of ea) balances.set(row.accountId, (balances.get(row.accountId) ?? 0) - (row._sum.amount ?? 0));
    for (const row of trFrom) balances.set(row.fromAccountId, (balances.get(row.fromAccountId) ?? 0) - (row._sum.amount ?? 0));
    for (const row of trTo) balances.set(row.toAccountId, (balances.get(row.toAccountId) ?? 0) + (row._sum.amount ?? 0));

    return balances;
}

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
            employeeAdvances,
            accountTransfers,
            accountsList,
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
                include: { employee: { select: { name: true } }, account: { select: { name: true } } },
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
            prisma.employeeAdvance.findMany({
                where: { date: { gte: startOfDay, lte: endOfDay } },
                include: { employee: { select: { name: true } }, account: { select: { name: true } } },
                orderBy: { date: "asc" },
            }),
            prisma.accountTransfer.findMany({
                where: { createdAt: { gte: startOfDay, lte: endOfDay } },
                include: {
                    fromAccount: { select: { name: true } },
                    toAccount: { select: { name: true } },
                },
                orderBy: { createdAt: "asc" },
            }),
            prisma.account.findMany({ where: { active: true } }),
        ]);

        // ── Segregate Sales & Returns ──
        const regularSales = sales.filter(s => s.parentSaleId === null && s.totalAmount >= 0);
        const saleReturns = sales.filter(s => s.parentSaleId !== null || s.totalAmount < 0);

        const regularPurchases = purchases.filter(p => p.parentPurchaseId === null && p.totalAmount >= 0);
        const purchaseReturns = purchases.filter(p => p.parentPurchaseId !== null || p.totalAmount < 0);

        // ── Aggregates ──
        const totalRevenue = regularSales.reduce((s, x) => s + x.totalAmount, 0);
        const totalDiscount = regularSales.reduce((s, x) => s + x.discount + x.items.reduce((is, item) => is + (item.discount || 0) * item.quantity, 0), 0);
        const totalTax = regularSales.reduce((s, x) => s + x.taxAmount, 0);
        const totalCOGS = regularSales.reduce((s, x) =>
            s + x.items.reduce((is, item) => is + item.avgCostPrice * item.quantity, 0), 0);
        const totalSalesPaid = regularSales.reduce((s, x) => s + x.paidAmount, 0);

        const totalSaleReturns = saleReturns.reduce((s, x) => s + Math.abs(x.totalAmount), 0);
        const totalSaleReturnsCOGS = saleReturns.reduce((s, x) =>
            s + Math.abs(x.items.reduce((is, item) => is + item.avgCostPrice * item.quantity, 0)), 0);

        const netRevenue = totalRevenue - totalSaleReturns;
        const netCOGS = totalCOGS - totalSaleReturnsCOGS;
        const grossProfit = netRevenue - netCOGS;

        const totalPurchases = regularPurchases.reduce((s, x) => s + x.totalAmount, 0);
        const totalPurchasesPaid = regularPurchases.reduce((s, x) => s + x.paidAmount, 0);

        const totalPurchaseReturns = purchaseReturns.reduce((s, x) => s + Math.abs(x.totalAmount), 0);

        const totalExpenses = expenses.reduce((s, x) => s + x.amount, 0);
        const totalSalaries = salarySlips.reduce((s, x) => s + x.netPayable, 0);
        const totalCustPayments = customerPayments.reduce((s, x) => s + x.amount, 0);
        const totalSuppPayments = supplierPayments.reduce((s, x) => s + x.amount, 0);
        const dailyRecurringExpenses = recurringExpenses.reduce((s, x) => {
            let amount = x.amount;
            if (x.frequency === 'MONTHLY') amount /= 30;
            else if (x.frequency === 'WEEKLY') amount /= 7;
            else if (x.frequency === 'YEARLY') amount /= 365;
            return s + amount;
        }, 0);
        const netProfit = grossProfit - totalExpenses - totalSalaries - dailyRecurringExpenses;

        const salesCount = regularSales.length;
        const returnsCount = saleReturns.length;
        const dailyQr = await generateQRBuffer(`Daily Report | ${fmtDate(dateStr)} | Sales: ${salesCount} | Returns: ${returnsCount} | Purchases: ${regularPurchases.length}`);
        const pdfGen = createPDFGenerator(pdfConfig(
            "Daily Report",
            `Summary for ${fmtDate(dateStr)}`,
            {
                "Date": fmtDate(dateStr),
                "Sales": salesCount,
                "Returns": returnsCount,
                "Purchases": regularPurchases.length,
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
                // Highlight Gross Profit (row index 7) and Net Profit (row index 15)
                if (row === 7 || row === 15) return { backgroundColor: "#e2e8f0", fontStyle: "bold", fontSize: 9 };
                if (row % 2 === 0) return { backgroundColor: "#f8fafc" };
                return {};
            },
        });
        [
            ["Metric", "Amount (Rs)"],
            [`Sales Revenue (${regularSales.length} invoices)`, fmtCurrency(totalRevenue)],
            [`Sales Returns (${saleReturns.length} returns)`, fmtCurrency(-totalSaleReturns)],
            [`  Discount Given`, fmtCurrency(totalDiscount)],
            [`  Tax Collected`, fmtCurrency(totalTax)],
            [`  COGS`, fmtCurrency(totalCOGS)],
            [`  COGS (Returned Items)`, fmtCurrency(-totalSaleReturnsCOGS)],
            [`  Gross Profit`, fmtCurrency(grossProfit)],
            [`Purchases (${regularPurchases.length} orders)`, fmtCurrency(totalPurchases)],
            [`Purchase Returns (${purchaseReturns.length} returns)`, fmtCurrency(-totalPurchaseReturns)],
            [`Expenses (${expenses.length})`, fmtCurrency(totalExpenses)],
            [`Recurring Expenses (Daily)`, fmtCurrency(dailyRecurringExpenses)],
            [`Salaries Paid (${salarySlips.length})`, fmtCurrency(totalSalaries)],
            [`Customer Payments Received`, fmtCurrency(totalCustPayments)],
            [`Supplier Payments Made`, fmtCurrency(totalSuppPayments)],
            [`Net Profit`, fmtCurrency(netProfit)],
        ].forEach((row, i) => {
            summaryTable.row([
                { text: row[0], align: { x: "left", y: "center" } },
                { text: row[1], align: { x: "right", y: "center" } },
            ]);
        });
        summaryTable.end();
        pdfGen.moveDown(0.8);

        // ── Account balances & cash flow ──
        const accountIds = accountsList.map(a => a.id);
        const openingBalances = await computeBalancesForIdsBeforeDate(accountIds, startOfDay);

        const accountSummaryMap = new Map<number, { code: string; name: string; opening: number; cashIn: number; cashOut: number }>();
        for (const account of accountsList) {
            accountSummaryMap.set(account.id, {
                code: account.code,
                name: account.name,
                opening: openingBalances.get(account.id) ?? 0,
                cashIn: 0,
                cashOut: 0,
            });
        }

        // 1. SalePayments
        for (const s of sales) {
            for (const p of s.payments) {
                const acc = accountSummaryMap.get(p.accountId);
                if (acc) {
                    if (p.amount >= 0) {
                        acc.cashIn += p.amount;
                    } else {
                        acc.cashOut += Math.abs(p.amount);
                    }
                }
            }
        }

        // 2. CustomerPayments
        for (const cp of customerPayments) {
            const acc = accountSummaryMap.get(cp.accountId);
            if (acc) {
                if (cp.type === "SENT") {
                    acc.cashOut += cp.amount;
                } else {
                    acc.cashIn += cp.amount;
                }
            }
        }

        // 3. SupplierPayments
        for (const sp of supplierPayments) {
            const acc = accountSummaryMap.get(sp.accountId);
            if (acc) {
                if (sp.type === "RECEIVED") {
                    acc.cashIn += sp.amount;
                } else {
                    acc.cashOut += sp.amount;
                }
            }
        }

        // 4. PurchasePayments
        for (const p of purchases) {
            for (const pm of p.payments) {
                const acc = accountSummaryMap.get(pm.accountId);
                if (acc) {
                    if (pm.amount >= 0) {
                        acc.cashOut += pm.amount;
                    } else {
                        acc.cashIn += Math.abs(pm.amount);
                    }
                }
            }
        }

        // 5. Expenses
        for (const ex of expenses) {
            const acc = accountSummaryMap.get(ex.accountId);
            if (acc) {
                acc.cashOut += ex.amount;
            }
        }

        // 6. SalarySlips
        for (const sl of salarySlips) {
            if (sl.accountId) {
                const acc = accountSummaryMap.get(sl.accountId);
                if (acc) {
                    acc.cashOut += sl.netPayable;
                }
            }
        }

        // 7. EmployeeAdvances
        for (const ea of employeeAdvances) {
            const acc = accountSummaryMap.get(ea.accountId);
            if (acc) {
                acc.cashOut += ea.amount;
            }
        }

        // 8. AccountTransfers
        for (const tr of accountTransfers) {
            const fromAcc = accountSummaryMap.get(tr.fromAccountId);
            if (fromAcc) {
                fromAcc.cashOut += tr.amount;
            }
            const toAcc = accountSummaryMap.get(tr.toAccountId);
            if (toAcc) {
                toAcc.cashIn += tr.amount;
            }
        }

        sectionHeader("Account Balances & Cash Flow", "#1e3a8a");
        doc.x = doc.page.margins.left;
        doc.fontSize(8);
        const accountTable = doc.table({
            columnStyles: [60, "*", 90, 90, 90, 90],
            rowStyles: (row: number) => {
                if (row === 0) return { backgroundColor: "#e2e8f0", fontSize: 9, fontStyle: "bold" };
                if (row % 2 === 0) return { backgroundColor: "#f8fafc" };
                return {};
            },
        });
        accountTable.row([
            "Code", "Account Name", "Opening (Rs)", "Cash In (Rs)", "Cash Out (Rs)", "Closing (Rs)"
        ].map(h => ({ text: h, align: { x: "center", y: "center" } })));

        let grandOpening = 0;
        let grandCashIn = 0;
        let grandCashOut = 0;
        let grandClosing = 0;

        accountsList.forEach(acc => {
            const summary = accountSummaryMap.get(acc.id)!;
            const closing = summary.opening + summary.cashIn - summary.cashOut;

            grandOpening += summary.opening;
            grandCashIn += summary.cashIn;
            grandCashOut += summary.cashOut;
            grandClosing += closing;

            accountTable.row([
                { text: summary.code, align: { x: "center", y: "center" } },
                { text: summary.name, align: { x: "left", y: "center" } },
                { text: fmtCurrency(summary.opening), align: { x: "right", y: "center" } },
                { text: fmtCurrency(summary.cashIn), align: { x: "right", y: "center" } },
                { text: fmtCurrency(summary.cashOut), align: { x: "right", y: "center" } },
                { text: fmtCurrency(closing), align: { x: "right", y: "center" } },
            ]);
        });

        accountTable.row([
            { text: "Total", colSpan: 2, align: { x: "right", y: "center" } },
            { text: fmtCurrency(grandOpening), align: { x: "right", y: "center" } },
            { text: fmtCurrency(grandCashIn), align: { x: "right", y: "center" } },
            { text: fmtCurrency(grandCashOut), align: { x: "right", y: "center" } },
            { text: fmtCurrency(grandClosing), align: { x: "right", y: "center" } },
        ]);
        accountTable.end();
        pdfGen.moveDown(0.8);

        // ── Purchases table ──
        if (regularPurchases.length > 0) {
            sectionHeader(`Purchases (${regularPurchases.length})`, "#1e3a8a");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 60, "*", 80, 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#dbeafe", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Supplier", "Total", "Paid"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            regularPurchases.forEach((p, i) => {
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

        // ── Purchase Returns table ──
        if (purchaseReturns.length > 0) {
            sectionHeader(`Purchase Returns (${purchaseReturns.length})`, "#c2410c");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 60, "*", 80, 80, 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ffedd5", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Supplier", "Total Return", "Paid Back", "Orig. Invoice #"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            purchaseReturns.forEach((p, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(p.date, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: p.supplier?.name ?? "N/A", align: { x: "left", y: "center" } },
                    { text: fmtCurrency(Math.abs(p.totalAmount)), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(Math.abs(p.paidAmount)), align: { x: "right", y: "center" } },
                    { text: p.parentPurchaseId ? `#${p.parentPurchaseId}` : "N/A", align: { x: "center", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 3, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalPurchaseReturns), align: { x: "right", y: "center" } },
                { text: fmtCurrency(purchaseReturns.reduce((s, x) => s + Math.abs(x.paidAmount), 0)), align: { x: "right", y: "center" } },
                { text: "", align: { x: "center", y: "center" } },
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
                columnStyles: [30, 60, "*", 100, 90, 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#fee2e2", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Description", "Category", "Account", "Amount"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            expenses.forEach((ex, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(ex.date, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: ex.description, align: { x: "left", y: "center" } },
                    { text: ex.category, align: { x: "left", y: "center" } },
                    { text: ex.account.name, align: { x: "left", y: "center" } },
                    { text: fmtCurrency(ex.amount), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 5, align: { x: "right", y: "center" } },
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
                columnStyles: [30, "*", 70, 90, 70, 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ede9fe", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Employee", "Month/Year", "Account", "Advances", "Net Paid"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            salarySlips.forEach((sl, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: sl.employee.name, align: { x: "left", y: "center" } },
                    { text: `${sl.month}/${sl.year}`, align: { x: "center", y: "center" } },
                    { text: sl.account?.name ?? "N/A", align: { x: "left", y: "center" } },
                    { text: fmtCurrency(sl.totalAdvances), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(sl.netPayable), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 4, align: { x: "right", y: "center" } },
                { text: fmtCurrency(salarySlips.reduce((s, x) => s + x.totalAdvances, 0)), align: { x: "right", y: "center" } },
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
                columnStyles: [30, 60, "*", 90, 80, "*"],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ccfbf1", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Customer", "Account", "Amount", "Note"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            customerPayments.forEach((cp, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(cp.date, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: cp.customer.name, align: { x: "left", y: "center" } },
                    { text: cp.account.name, align: { x: "left", y: "center" } },
                    { text: fmtCurrency(cp.amount), align: { x: "right", y: "center" } },
                    { text: cp.note ?? "", align: { x: "left", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 4, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalCustPayments), align: { x: "right", y: "center" } },
                { text: "", align: { x: "center", y: "center" } },
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
                columnStyles: [30, 60, "*", 90, 80, "*"],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ffedd5", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Supplier", "Account", "Amount", "Note"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            supplierPayments.forEach((sp, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(sp.date, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: sp.supplier.name, align: { x: "left", y: "center" } },
                    { text: sp.account.name, align: { x: "left", y: "center" } },
                    { text: fmtCurrency(sp.amount), align: { x: "right", y: "center" } },
                    { text: sp.note ?? "", align: { x: "left", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 4, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalSuppPayments), align: { x: "right", y: "center" } },
                { text: "", align: { x: "center", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.8);
        }

        // ── Employee Advances table ──
        if (employeeAdvances.length > 0) {
            sectionHeader(`Employee Advances Given (${employeeAdvances.length})`, "#65a30d");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 60, "*", 90, 80, "*"],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f7fee7", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Employee", "Account", "Amount", "Reason"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            employeeAdvances.forEach((ea, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(ea.date, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: ea.employee.name, align: { x: "left", y: "center" } },
                    { text: ea.account.name, align: { x: "left", y: "center" } },
                    { text: fmtCurrency(ea.amount), align: { x: "right", y: "center" } },
                    { text: ea.reason ?? "", align: { x: "left", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 4, align: { x: "right", y: "center" } },
                { text: fmtCurrency(employeeAdvances.reduce((s, x) => s + x.amount, 0)), align: { x: "right", y: "center" } },
                { text: "", align: { x: "center", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.8);
        }

        // ── Account Transfers table ──
        if (accountTransfers.length > 0) {
            sectionHeader(`Account Transfers (${accountTransfers.length})`, "#475569");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 60, "*", "*", 80, "*"],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f1f5f9", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "From Account", "To Account", "Amount", "Note"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            accountTransfers.forEach((tr, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(tr.createdAt, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: tr.fromAccount.name, align: { x: "left", y: "center" } },
                    { text: tr.toAccount.name, align: { x: "left", y: "center" } },
                    { text: fmtCurrency(tr.amount), align: { x: "right", y: "center" } },
                    { text: tr.note ?? "", align: { x: "left", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 4, align: { x: "right", y: "center" } },
                { text: fmtCurrency(accountTransfers.reduce((s, x) => s + x.amount, 0)), align: { x: "right", y: "center" } },
                { text: "", align: { x: "center", y: "center" } },
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
