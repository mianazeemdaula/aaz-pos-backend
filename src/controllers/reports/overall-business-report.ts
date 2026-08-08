import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import {
    fmtDate,
    fmtCurrency,
    createReport,
    sendReport,
    safeAvgCost,
} from "./helpers";
import type { TableCell } from "../../utils/pdf/report-spec";
import {
    computeAllCustomerBalances,
    computeAllSupplierBalances
} from "../../utils/balance";

export const getOverallBusinessReportPDF = async (req: Request, res: Response): Promise<void> => {
    const fromStr = (req.query.from as string) ?? dayjs().startOf("month").format("YYYY-MM-DD");
    const toStr = (req.query.to as string) ?? dayjs().endOf("month").format("YYYY-MM-DD");

    const fromDate = dayjs(fromStr).startOf("day").toDate();
    const toDate = dayjs(toStr).endOf("day").toDate();

    try {
        const [
            sales,
            saleReturns,
            purchases,
            expensesByCategory,
            salaryPaidAgg,
            activeCustomers,
            activeSuppliers,
            accounts,
            products
        ] = await Promise.all([
            // Sales in date range
            prisma.sale.findMany({
                where: { createdAt: { gte: fromDate, lte: toDate }, parentSaleId: null },
                include: { items: true }
            }),
            // Sale returns in date range
            prisma.sale.findMany({
                where: { createdAt: { gte: fromDate, lte: toDate }, parentSaleId: { not: null } },
                include: { items: true }
            }),
            // Purchases in date range
            prisma.purchase.findMany({
                where: { date: { gte: fromDate, lte: toDate } }
            }),
            // Expenses by category
            prisma.expense.groupBy({
                by: ["category"],
                where: { date: { gte: fromDate, lte: toDate } },
                _sum: { amount: true }
            }),
            // Salaries paid in date range
            prisma.salarySlip.aggregate({
                where: { status: "PAID", paidDate: { gte: fromDate, lte: toDate } },
                _sum: { netPayable: true }
            }),
            // Active customers
            prisma.customer.findMany({ where: { active: true }, select: { id: true, name: true, phone: true } }),
            // Active suppliers
            prisma.supplier.findMany({ where: { active: true }, select: { id: true, name: true, phone: true } }),
            // All accounts
            prisma.account.findMany({ where: { active: true } }),
            // Products
            prisma.product.findMany({ where: { active: true }, select: { id: true, name: true, totalStock: true, avgCostPrice: true, reorderLevel: true } })
        ]);

        // 1. Sales & Profitability Math
        let grossSales = 0;
        let totalDiscount = 0;
        let totalTax = 0;
        let cogs = 0;

        for (const s of sales) {
            grossSales += s.totalAmount;
            totalDiscount += s.discount;
            totalTax += s.taxAmount;
            for (const item of s.items) {
                const itemCogs = safeAvgCost(item.avgCostPrice ?? 0, item.unitPrice) * item.quantity;
                cogs += itemCogs;
            }
        }

        let returnSales = 0;
        let returnCogs = 0;
        for (const r of saleReturns) {
            returnSales += r.totalAmount;
            for (const item of r.items) {
                const itemCogs = safeAvgCost(item.avgCostPrice ?? 0, item.unitPrice) * item.quantity;
                returnCogs += itemCogs;
            }
        }

        const netSales = grossSales - returnSales;
        const netCogs = cogs - returnCogs;
        const grossProfit = netSales - netCogs;
        const grossProfitMargin = netSales > 0 ? (grossProfit / netSales) * 100 : 0;

        // 2. Expenses & Payroll
        const totalDirectExpenses = expensesByCategory.reduce((sum, e) => sum + (e._sum.amount ?? 0), 0);
        const totalSalaries = salaryPaidAgg._sum.netPayable ?? 0;
        const totalOperationalExpenses = totalDirectExpenses + totalSalaries;
        const netOperatingProfit = grossProfit - totalOperationalExpenses;

        // 3. Receivables & Payables Position
        const customerBalanceMap = await computeAllCustomerBalances();
        const supplierBalanceMap = await computeAllSupplierBalances();

        let totalReceivables = 0;
        let totalOverpaidCustomers = 0;
        let receivableCustomersCount = 0;
        const customerListWithBalances = activeCustomers.map(c => {
            const bal = customerBalanceMap.get(c.id) ?? 0;
            if (bal > 0) { totalReceivables += bal; receivableCustomersCount++; }
            else if (bal < 0) { totalOverpaidCustomers += Math.abs(bal); }
            return { ...c, balance: bal };
        }).sort((a, b) => b.balance - a.balance);

        let totalPayables = 0;
        let totalAdvanceSuppliers = 0;
        let payableSuppliersCount = 0;
        const supplierListWithBalances = activeSuppliers.map(s => {
            const bal = supplierBalanceMap.get(s.id) ?? 0;
            if (bal > 0) { totalPayables += bal; payableSuppliersCount++; }
            else if (bal < 0) { totalAdvanceSuppliers += Math.abs(bal); }
            return { ...s, balance: bal };
        }).sort((a, b) => b.balance - a.balance);

        // 4. Cash & Bank Account Balances
        const [salePmts, custPmts, purPmts, expPmts, suppPmts, salPmts, advPmts, trFrom, trTo] = await Promise.all([
            prisma.salePayment.groupBy({ by: ["accountId"], _sum: { amount: true } }),
            prisma.customerPayment.groupBy({ by: ["accountId", "type"], _sum: { amount: true } }),
            prisma.purchasePayment.groupBy({ by: ["accountId"], _sum: { amount: true } }),
            prisma.expense.groupBy({ by: ["accountId"], _sum: { amount: true } }),
            prisma.supplierPayment.groupBy({ by: ["accountId", "type"], _sum: { amount: true } }),
            prisma.salarySlip.groupBy({ by: ["accountId"], where: { status: "PAID" }, _sum: { netPayable: true } }),
            prisma.employeeAdvance.groupBy({ by: ["accountId"], _sum: { amount: true } }),
            prisma.accountTransfer.groupBy({ by: ["fromAccountId"], _sum: { amount: true } }),
            prisma.accountTransfer.groupBy({ by: ["toAccountId"], _sum: { amount: true } }),
        ]);

        const acctMap = new Map<number, number>();
        accounts.forEach(a => acctMap.set(a.id, 0));

        for (const row of salePmts) acctMap.set(row.accountId, (acctMap.get(row.accountId) ?? 0) + (row._sum.amount ?? 0));
        for (const row of custPmts) {
            const val = row._sum.amount ?? 0;
            acctMap.set(row.accountId, (acctMap.get(row.accountId) ?? 0) + (row.type === 'SENT' ? -val : val));
        }
        for (const row of purPmts) acctMap.set(row.accountId, (acctMap.get(row.accountId) ?? 0) - (row._sum.amount ?? 0));
        for (const row of expPmts) acctMap.set(row.accountId, (acctMap.get(row.accountId) ?? 0) - (row._sum.amount ?? 0));
        for (const row of suppPmts) {
            const val = row._sum.amount ?? 0;
            acctMap.set(row.accountId, (acctMap.get(row.accountId) ?? 0) + (row.type === 'RECEIVED' ? val : -val));
        }
        for (const row of salPmts) if (row.accountId) acctMap.set(row.accountId, (acctMap.get(row.accountId) ?? 0) - (row._sum.netPayable ?? 0));
        for (const row of advPmts) acctMap.set(row.accountId, (acctMap.get(row.accountId) ?? 0) - (row._sum.amount ?? 0));
        for (const row of trFrom) acctMap.set(row.fromAccountId, (acctMap.get(row.fromAccountId) ?? 0) - (row._sum.amount ?? 0));
        for (const row of trTo) acctMap.set(row.toAccountId, (acctMap.get(row.toAccountId) ?? 0) + (row._sum.amount ?? 0));

        const totalCashAndBank = accounts.filter(a => a.type === 'ASSET').reduce((sum, a) => sum + (acctMap.get(a.id) ?? 0), 0);

        // 5. Inventory Valuation
        let totalInventoryValue = 0;
        let totalStockUnits = 0;
        let lowStockItems = 0;
        let negativeStockItems = 0;

        for (const p of products) {
            totalStockUnits += p.totalStock;
            if (p.totalStock < 0) negativeStockItems++;
            if (p.totalStock <= p.reorderLevel) lowStockItems++;
            const cost = p.avgCostPrice > 0 ? p.avgCostPrice : 0;
            totalInventoryValue += Math.max(0, p.totalStock) * cost;
        }

        // 6. Net Business Asset Valuation
        const netWorkingCapital = totalReceivables - totalPayables;
        const estimatedNetBusinessValue = totalCashAndBank + totalReceivables + totalInventoryValue - totalPayables;

        const report = createReport({
            title: "Overall Business Report",
            subtitle: "Financial position, P&L, receivables, payables and asset valuation",
            filename: `Overall_Business_Report_${fromStr}_to_${toStr}.pdf`,
            disposition: "inline",
            filters: {
                Period: `${fromStr} \u2014 ${toStr}`,
                "Net Sales": fmtCurrency(netSales),
                "Net Profit": fmtCurrency(netOperatingProfit),
            },
        });

        report.section("Financial Position", "Where the business stands right now");
        report.stats([
            { label: "Estimated Net Assets", value: fmtCurrency(estimatedNetBusinessValue), tone: estimatedNetBusinessValue < 0 ? "danger" : "primary", note: "cash + stock + receivables \u2212 payables" },
            { label: "Cash & Bank", value: fmtCurrency(totalCashAndBank), tone: "success" },
            { label: "Inventory Value", value: fmtCurrency(totalInventoryValue), tone: "primary" },
            { label: "Receivables", value: fmtCurrency(totalReceivables), tone: "warning", note: `${receivableCustomersCount} customers` },
            { label: "Payables", value: fmtCurrency(totalPayables), tone: "danger", note: `${payableSuppliersCount} suppliers` },
            { label: "Working Capital", value: fmtCurrency(netWorkingCapital), tone: netWorkingCapital < 0 ? "danger" : "success" },
        ]);

        report.section("Trading Performance", `${fromStr} to ${toStr}`);
        report.stats([
            { label: "Net Revenue", value: fmtCurrency(netSales), tone: "primary" },
            { label: "Gross Profit", value: fmtCurrency(grossProfit), tone: grossProfit < 0 ? "danger" : "success", note: `${grossProfitMargin.toFixed(1)}% margin` },
            { label: "Net Operating Profit", value: fmtCurrency(netOperatingProfit), tone: netOperatingProfit < 0 ? "danger" : "success" },
            { label: "Cost of Goods Sold", value: fmtCurrency(netCogs), tone: "muted" },
            { label: "Operating Expenses", value: fmtCurrency(totalDirectExpenses), tone: "danger" },
            { label: "Payroll Paid", value: fmtCurrency(totalSalaries), tone: "danger" },
        ]);

        report.section("Profit & Loss Statement", `${fromStr} to ${toStr}`);
        report.table({
            columns: [
                { label: "Income & Revenue", width: "*" },
                { label: "Amount (Rs)", width: 100, align: "right" },
                { label: "Costs & Expenses", width: "*" },
                { label: "Amount (Rs)", width: 100, align: "right" },
            ],
            rows: [
                ["Gross Sales Revenue", fmtCurrency(grossSales), "Cost of Goods Sold", fmtCurrency(netCogs)],
                ["Sales Returns (\u2212)", `-${fmtCurrency(returnSales)}`, "Operating Expenses", fmtCurrency(totalDirectExpenses)],
                ["Net Revenue", fmtCurrency(netSales), "Salaries / Payroll Paid", fmtCurrency(totalSalaries)],
            ] as TableCell[][],
            totalRow: [
                { text: `Gross Profit (${grossProfitMargin.toFixed(1)}%)` },
                { text: fmtCurrency(grossProfit), align: "right", tone: grossProfit < 0 ? "danger" : "success" },
                { text: "Net Operating Profit" },
                { text: fmtCurrency(netOperatingProfit), align: "right", tone: netOperatingProfit < 0 ? "danger" : "success" },
            ],
        });

        report.section("Party Balances", "Working capital by counterparty");
        report.table({
            columns: [
                { label: "Category", width: "*" },
                { label: "Parties", width: 70, align: "center" },
                { label: "Amount (Rs)", width: 110, align: "right" },
                { label: "Note", width: 130, align: "center" },
            ],
            rows: [
                ["Accounts Receivable (customers owing)", String(receivableCustomersCount), fmtCurrency(totalReceivables), "Incoming funds"],
                ["Accounts Payable (suppliers owed)", String(payableSuppliersCount), fmtCurrency(totalPayables), "Outgoing liabilities"],
                ["Customer Advances / Overpaid", String(activeCustomers.length - receivableCustomersCount), fmtCurrency(totalOverpaidCustomers), "Customer prepayments"],
                ["Supplier Advances Paid", String(activeSuppliers.length - payableSuppliersCount), fmtCurrency(totalAdvanceSuppliers), "Supplier prepayments"],
            ] as TableCell[][],
        });

        const topCustomers = customerListWithBalances.filter(c => c.balance > 0).slice(0, 5);
        const topSuppliers = supplierListWithBalances.filter(s => s.balance > 0).slice(0, 5);
        const maxRows = Math.max(topCustomers.length, topSuppliers.length, 1);
        const topRows: TableCell[][] = [];
        for (let i = 0; i < maxRows; i++) {
            const cust = topCustomers[i];
            const supp = topSuppliers[i];
            topRows.push([
                cust ? `${i + 1}. ${cust.name}` : "\u2014",
                cust ? { text: fmtCurrency(cust.balance), align: "right", tone: "warning" } : "\u2014",
                supp ? `${i + 1}. ${supp.name}` : "\u2014",
                supp ? { text: fmtCurrency(supp.balance), align: "right", tone: "danger" } : "\u2014",
            ]);
        }

        report.section("Top Outstanding Balances", "Largest five on each side");
        report.table({
            columns: [
                { label: "Top Due Customers", width: "*" },
                { label: "Receivable (Rs)", width: 96, align: "right" },
                { label: "Top Owed Suppliers", width: "*" },
                { label: "Payable (Rs)", width: 96, align: "right" },
            ],
            rows: topRows,
        });

        report.section("Inventory & Liquid Assets", "Stock health and cash position");
        report.stats([
            { label: "Active Products", value: String(products.length), tone: "primary" },
            { label: "Stock Units", value: fmtCurrency(totalStockUnits) },
            { label: "Low / Reorder Items", value: String(lowStockItems), tone: lowStockItems ? "warning" : "success" },
            { label: "Negative Stock", value: String(negativeStockItems), tone: negativeStockItems ? "danger" : "success" },
            { label: "Cash Accounts", value: String(accounts.filter(a => a.type === 'ASSET').length), tone: "muted" },
            {
                label: "Total Assets",
                value: fmtCurrency(totalCashAndBank + totalInventoryValue + totalReceivables),
                tone: "primary",
                note: "cash + stock + receivables",
            },
        ]);

        await sendReport(res, report);
    } catch (err) {
        console.error("Error generating overall business report:", err);
        res.status(500).json({ error: "Failed to generate overall business report" });
    }
};

export const getOverallPayablesReceivablesReportPDF = async (req: Request, res: Response): Promise<void> => {
    try {
        const [activeCustomers, activeSuppliers] = await Promise.all([
            prisma.customer.findMany({ where: { active: true } }),
            prisma.supplier.findMany({ where: { active: true } })
        ]);

        const customerBalanceMap = await computeAllCustomerBalances();
        const supplierBalanceMap = await computeAllSupplierBalances();

        const customers = activeCustomers
            .map(c => ({ ...c, balance: customerBalanceMap.get(c.id) ?? 0 }))
            .filter(c => c.balance !== 0)
            .sort((a, b) => b.balance - a.balance);

        const suppliers = activeSuppliers
            .map(s => ({ ...s, balance: supplierBalanceMap.get(s.id) ?? 0 }))
            .filter(s => s.balance !== 0)
            .sort((a, b) => b.balance - a.balance);

        const totalReceivable = customers.filter(c => c.balance > 0).reduce((s, c) => s + c.balance, 0);
        const totalPayable = suppliers.filter(s => s.balance > 0).reduce((s, s1) => s + s1.balance, 0);
        const netWorkingPosition = totalReceivable - totalPayable;

        const dueCustomers = customers.filter(c => c.balance > 0).length;
        const dueSuppliers = suppliers.filter(s => s.balance > 0).length;

        const report = createReport({
            title: "Receivables & Payables",
            subtitle: "Accounts receivable (customers) and accounts payable (suppliers)",
            filename: "Payables_and_Receivables_Summary.pdf",
            orientation: "landscape",
            disposition: "inline",
            filters: {
                Customers: customers.length,
                Suppliers: suppliers.length,
                "As of": fmtDate(new Date()),
            },
        });

        report.stats([
            { label: "Customers Due", value: String(dueCustomers), tone: "primary" },
            { label: "Total Receivable", value: fmtCurrency(totalReceivable), tone: "warning", note: "owed to you" },
            { label: "Suppliers Due", value: String(dueSuppliers), tone: "primary" },
            { label: "Total Payable", value: fmtCurrency(totalPayable), tone: "danger", note: "you owe" },
            {
                label: "Net Working Position",
                value: fmtCurrency(netWorkingPosition),
                tone: netWorkingPosition < 0 ? "danger" : "success",
            },
        ]);

        report.section("Accounts Receivable", `${customers.length} customer(s) with a balance`);
        if (customers.length === 0) {
            report.note("No outstanding customer balances.");
        } else {
            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Customer Name", width: "*" },
                    { label: "Phone", width: 92, align: "center" },
                    { label: "City", width: 110 },
                    { label: "Balance (Rs)", width: 92, align: "right" },
                    { label: "Type", width: 86, align: "center" },
                ],
                rows: customers.map((c, idx) => [
                    String(idx + 1),
                    c.name,
                    c.phone ?? "N/A",
                    c.city ?? "N/A",
                    { text: fmtCurrency(c.balance), align: "right", tone: c.balance > 0 ? "warning" : "muted" },
                    { text: c.balance > 0 ? "RECEIVABLE" : "PREPAID", align: "center", tone: c.balance > 0 ? "warning" : "muted" },
                ]) as TableCell[][],
                totalRow: [
                    { text: "Total Receivable", colSpan: 4 },
                    fmtCurrency(totalReceivable),
                    "",
                ],
            });
        }

        report.section("Accounts Payable", `${suppliers.length} supplier(s) with a balance`);
        if (suppliers.length === 0) {
            report.note("No outstanding supplier balances.");
        } else {
            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Supplier Name", width: "*" },
                    { label: "Phone", width: 92, align: "center" },
                    { label: "City", width: 110 },
                    { label: "Balance (Rs)", width: 92, align: "right" },
                    { label: "Type", width: 96, align: "center" },
                ],
                rows: suppliers.map((sup, idx) => [
                    String(idx + 1),
                    sup.name,
                    sup.phone ?? "N/A",
                    sup.city ?? "N/A",
                    { text: fmtCurrency(sup.balance), align: "right", tone: sup.balance > 0 ? "danger" : "muted" },
                    { text: sup.balance > 0 ? "PAYABLE" : "ADVANCE PAID", align: "center", tone: sup.balance > 0 ? "danger" : "muted" },
                ]) as TableCell[][],
                totalRow: [
                    { text: "Total Payable", colSpan: 4 },
                    fmtCurrency(totalPayable),
                    "",
                ],
            });
        }

        await sendReport(res, report);
    } catch (err) {
        console.error("Error generating payables and receivables report:", err);
        res.status(500).json({ error: "Failed to generate payables and receivables report" });
    }
};
