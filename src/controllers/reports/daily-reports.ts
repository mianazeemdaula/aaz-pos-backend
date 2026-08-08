import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import {
    fmtDate,
    fmtCurrency,
    createReport,
    sendReport,
} from "./helpers";
import type { TableCell } from "../../utils/pdf/report-spec";

// Helper to format real transaction time (using createdAt when date has 00:00:00 UTC / date-only)
function getDisplayTime(item: { createdAt?: Date | string; date?: Date | string }): string {
    const cDate = item.createdAt ? new Date(item.createdAt) : null;
    const dDate = item.date ? new Date(item.date) : null;
    
    if (dDate && !isNaN(dDate.getTime())) {
        const hours = dDate.getUTCHours();
        const mins = dDate.getUTCMinutes();
        const secs = dDate.getUTCSeconds();
        if (hours !== 0 || mins !== 0 || secs !== 0) {
            return fmtDate(dDate, "hh:mm A");
        }
    }
    if (cDate && !isNaN(cDate.getTime())) {
        return fmtDate(cDate, "hh:mm A");
    }
    return dDate ? fmtDate(dDate, "hh:mm A") : "N/A";
}

// Helper to compute starting balances of active accounts prior to startOfDay
async function computeBalancesForIdsBeforeDate(accountIds: number[], beforeDate: Date): Promise<Map<number, number>> {
    if (accountIds.length === 0) return new Map();

    const [sp, cp, pp, ex, sup, sal, ea, trFrom, trTo, accounts] = await Promise.all([
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
        prisma.account.findMany({
            where: { id: { in: accountIds } },
            select: { id: true, openingBalance: true }
        }),
    ]);

    const balances = new Map<number, number>(accounts.map(a => [a.id, a.openingBalance ?? 0]));

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
        const report = createReport({
            title: "Daily Report",
            subtitle: `Business summary for ${fmtDate(dateStr)}`,
            filename: `daily-report-${dateStr}.pdf`,
            filters: {
                Date: fmtDate(dateStr),
                Sales: salesCount,
                Returns: returnsCount,
                Purchases: regularPurchases.length,
                Expenses: expenses.length,
            },
        });

        const outgoings = totalExpenses + totalSalaries + dailyRecurringExpenses;

        report.stats([
            { label: "Net Revenue", value: fmtCurrency(netRevenue), tone: "primary", note: `${salesCount} invoices` },
            { label: "Gross Profit", value: fmtCurrency(grossProfit), tone: grossProfit < 0 ? "danger" : "success" },
            { label: "Outgoings", value: fmtCurrency(outgoings), tone: "danger", note: "expenses + salaries" },
            { label: "Net Profit", value: fmtCurrency(netProfit), tone: netProfit < 0 ? "danger" : "success" },
            { label: "Purchases", value: fmtCurrency(totalPurchases), tone: "muted", note: `${regularPurchases.length} orders` },
            { label: "Received", value: fmtCurrency(totalCustPayments), tone: "success", note: "customer payments" },
            { label: "Paid Out", value: fmtCurrency(totalSuppPayments), tone: "warning", note: "supplier payments" },
            {
                label: "Sales Returns",
                value: fmtCurrency(totalSaleReturns),
                tone: totalSaleReturns > 0 ? "warning" : "muted",
                note: `${returnsCount} returns`,
            },
        ]);

        report.section("Profit & Loss", `Line-by-line for ${fmtDate(dateStr)}`);
        report.table({
            columns: [
                { label: "Metric", width: "*" },
                { label: "Amount (Rs)", width: 150, align: "right" },
            ],
            rows: [
                [`Sales Revenue (${regularSales.length} invoices)`, fmtCurrency(totalRevenue)],
                [`Sales Returns (${saleReturns.length} returns)`, fmtCurrency(-totalSaleReturns)],
                ["    Discount Given", fmtCurrency(totalDiscount)],
                ["    Tax Collected", fmtCurrency(totalTax)],
                ["    Cost of Goods Sold", fmtCurrency(totalCOGS)],
                ["    COGS on Returned Items", fmtCurrency(-totalSaleReturnsCOGS)],
                [
                    { text: "Gross Profit", bold: true },
                    { text: fmtCurrency(grossProfit), align: "right", bold: true, tone: grossProfit < 0 ? "danger" : "success" },
                ],
                [`Purchases (${regularPurchases.length} orders)`, fmtCurrency(totalPurchases)],
                [`Purchase Returns (${purchaseReturns.length} returns)`, fmtCurrency(-totalPurchaseReturns)],
                [`Expenses (${expenses.length})`, fmtCurrency(totalExpenses)],
                ["Recurring Expenses (daily share)", fmtCurrency(dailyRecurringExpenses)],
                [`Salaries Paid (${salarySlips.length})`, fmtCurrency(totalSalaries)],
                ["Customer Payments Received", fmtCurrency(totalCustPayments)],
                ["Supplier Payments Made", fmtCurrency(totalSuppPayments)],
            ] as TableCell[][],
            totalRow: [
                { text: "Net Profit" },
                { text: fmtCurrency(netProfit), align: "right", tone: netProfit < 0 ? "danger" : "success" },
            ],
        });

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

        let grandOpening = 0;
        let grandCashIn = 0;
        let grandCashOut = 0;
        let grandClosing = 0;
        for (const acc of accountsList) {
            const summary = accountSummaryMap.get(acc.id)!;
            grandOpening += summary.opening;
            grandCashIn += summary.cashIn;
            grandCashOut += summary.cashOut;
            grandClosing += summary.opening + summary.cashIn - summary.cashOut;
        }

        report.section("Account Balances & Cash Flow", `${accountsList.length} account(s)`);
        report.table({
            columns: [
                { label: "Code", width: 58, align: "center" },
                { label: "Account Name", width: "*" },
                { label: "Opening", width: 88, align: "right" },
                { label: "Cash In", width: 88, align: "right" },
                { label: "Cash Out", width: 88, align: "right" },
                { label: "Closing", width: 88, align: "right" },
            ],
            rows: accountsList.map((acc) => {
                const summary = accountSummaryMap.get(acc.id)!;
                const closing = summary.opening + summary.cashIn - summary.cashOut;
                return [
                    summary.code,
                    summary.name,
                    fmtCurrency(summary.opening),
                    { text: fmtCurrency(summary.cashIn), align: "right", tone: summary.cashIn ? "success" : undefined },
                    { text: fmtCurrency(summary.cashOut), align: "right", tone: summary.cashOut ? "danger" : undefined },
                    { text: fmtCurrency(closing), align: "right", bold: true },
                ];
            }) as TableCell[][],
            totalRow: [
                { text: "Total", colSpan: 2 },
                fmtCurrency(grandOpening),
                fmtCurrency(grandCashIn),
                fmtCurrency(grandCashOut),
                fmtCurrency(grandClosing),
            ],
        });

        if (regularPurchases.length > 0) {
            report.section("Purchases", `${regularPurchases.length} order(s)`);
            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Time", width: 68, align: "center" },
                    { label: "Supplier", width: "*" },
                    { label: "Total", width: 92, align: "right" },
                    { label: "Paid", width: 92, align: "right" },
                ],
                rows: regularPurchases.map((p, i) => [
                    String(i + 1),
                    getDisplayTime(p),
                    p.supplier?.name ?? "N/A",
                    fmtCurrency(p.totalAmount),
                    fmtCurrency(p.paidAmount),
                ]),
                totalRow: [
                    { text: "Total", colSpan: 3 },
                    fmtCurrency(totalPurchases),
                    fmtCurrency(totalPurchasesPaid),
                ],
            });
        }

        if (purchaseReturns.length > 0) {
            report.section("Purchase Returns", `${purchaseReturns.length} return(s)`);
            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Time", width: 62, align: "center" },
                    { label: "Supplier", width: "*" },
                    { label: "Total Return", width: 84, align: "right" },
                    { label: "Paid Back", width: 78, align: "right" },
                    { label: "Orig. Invoice", width: 80, align: "center" },
                ],
                rows: purchaseReturns.map((p, i) => [
                    String(i + 1),
                    getDisplayTime(p),
                    p.supplier?.name ?? "N/A",
                    fmtCurrency(Math.abs(p.totalAmount)),
                    fmtCurrency(Math.abs(p.paidAmount)),
                    p.parentPurchaseId ? `#${p.parentPurchaseId}` : "N/A",
                ]),
                totalRow: [
                    { text: "Total", colSpan: 3 },
                    fmtCurrency(totalPurchaseReturns),
                    fmtCurrency(purchaseReturns.reduce((s, x) => s + Math.abs(x.paidAmount), 0)),
                    "",
                ],
            });
        }

        if (expenses.length > 0) {
            report.section("Expenses", `${expenses.length} entry(ies)`);
            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Time", width: 62, align: "center" },
                    { label: "Description", width: "*" },
                    { label: "Category", width: 96 },
                    { label: "Account", width: 88 },
                    { label: "Amount", width: 82, align: "right" },
                ],
                rows: expenses.map((ex, i) => [
                    String(i + 1),
                    getDisplayTime(ex),
                    ex.description,
                    ex.category,
                    ex.account.name,
                    fmtCurrency(ex.amount),
                ]),
                totalRow: [{ text: "Total", colSpan: 5 }, fmtCurrency(totalExpenses)],
            });
        }

        if (salarySlips.length > 0) {
            report.section("Salaries Paid", `${salarySlips.length} slip(s)`);
            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Employee", width: "*" },
                    { label: "Month/Year", width: 76, align: "center" },
                    { label: "Account", width: 92 },
                    { label: "Advances", width: 78, align: "right" },
                    { label: "Net Paid", width: 82, align: "right" },
                ],
                rows: salarySlips.map((sl, i) => [
                    String(i + 1),
                    sl.employee.name,
                    `${sl.month}/${sl.year}`,
                    sl.account?.name ?? "N/A",
                    fmtCurrency(sl.totalAdvances),
                    fmtCurrency(sl.netPayable),
                ]),
                totalRow: [
                    { text: "Total", colSpan: 4 },
                    fmtCurrency(salarySlips.reduce((s, x) => s + x.totalAdvances, 0)),
                    fmtCurrency(totalSalaries),
                ],
            });
        }

        if (customerPayments.length > 0) {
            report.section("Customer Payments Received", `${customerPayments.length} payment(s)`);
            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Time", width: 62, align: "center" },
                    { label: "Customer", width: "*" },
                    { label: "Account", width: 92 },
                    { label: "Amount", width: 82, align: "right" },
                    { label: "Note", width: 120 },
                ],
                rows: customerPayments.map((cp, i) => [
                    String(i + 1),
                    getDisplayTime(cp),
                    cp.customer.name,
                    cp.account.name,
                    fmtCurrency(cp.amount),
                    cp.note ?? "",
                ]),
                totalRow: [{ text: "Total", colSpan: 4 }, fmtCurrency(totalCustPayments), ""],
            });
        }

        if (supplierPayments.length > 0) {
            report.section("Supplier Payments Made", `${supplierPayments.length} payment(s)`);
            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Time", width: 62, align: "center" },
                    { label: "Supplier", width: "*" },
                    { label: "Account", width: 92 },
                    { label: "Amount", width: 82, align: "right" },
                    { label: "Note", width: 120 },
                ],
                rows: supplierPayments.map((sp, i) => [
                    String(i + 1),
                    getDisplayTime(sp),
                    sp.supplier.name,
                    sp.account.name,
                    fmtCurrency(sp.amount),
                    sp.note ?? "",
                ]),
                totalRow: [{ text: "Total", colSpan: 4 }, fmtCurrency(totalSuppPayments), ""],
            });
        }

        if (employeeAdvances.length > 0) {
            report.section("Employee Advances Given", `${employeeAdvances.length} advance(s)`);
            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Time", width: 62, align: "center" },
                    { label: "Employee", width: "*" },
                    { label: "Account", width: 92 },
                    { label: "Amount", width: 82, align: "right" },
                    { label: "Reason", width: 120 },
                ],
                rows: employeeAdvances.map((ea, i) => [
                    String(i + 1),
                    getDisplayTime(ea),
                    ea.employee.name,
                    ea.account.name,
                    fmtCurrency(ea.amount),
                    ea.reason ?? "",
                ]),
                totalRow: [
                    { text: "Total", colSpan: 4 },
                    fmtCurrency(employeeAdvances.reduce((s, x) => s + x.amount, 0)),
                    "",
                ],
            });
        }

        if (accountTransfers.length > 0) {
            report.section("Account Transfers", `${accountTransfers.length} transfer(s)`);
            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Time", width: 62, align: "center" },
                    { label: "From Account", width: "*" },
                    { label: "To Account", width: "*" },
                    { label: "Amount", width: 82, align: "right" },
                    { label: "Note", width: 110 },
                ],
                rows: accountTransfers.map((tr, i) => [
                    String(i + 1),
                    fmtDate(tr.createdAt, "hh:mm A"),
                    tr.fromAccount.name,
                    tr.toAccount.name,
                    fmtCurrency(tr.amount),
                    tr.note ?? "",
                ]),
                totalRow: [
                    { text: "Total", colSpan: 4 },
                    fmtCurrency(accountTransfers.reduce((s, x) => s + x.amount, 0)),
                    "",
                ],
            });
        }

        if (recurringExpenses.length > 0) {
            report.section("Active Recurring Expenses", `${recurringExpenses.length} configured`);
            report.table({
                columns: [
                    { label: "Name", width: "*" },
                    { label: "Category", width: "*" },
                    { label: "Frequency", width: 100 },
                    { label: "Amount (Rs)", width: 92, align: "right" },
                ],
                rows: recurringExpenses.map((re) => [re.name, re.category, re.frequency, fmtCurrency(re.amount)]),
            });
        }

        report.signatures([
            { label: "Prepared By", name: "_________________", title: "Cashier" },
            { label: "Reviewed By", name: "_________________", title: "Manager" },
            { label: "Approved By", name: "_________________", title: "Owner" },
        ]);

        await sendReport(res, report);
    } catch (error) {
        console.error("Daily report PDF error:", error);
        res.status(500).json({ error: "Failed to generate daily report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
