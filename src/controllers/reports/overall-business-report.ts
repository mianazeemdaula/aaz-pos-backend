import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import {
    fmtDate,
    fmtCurrency,
    pdfConfig,
    generateQRBuffer,
    createPDFGenerator,
    safeAvgCost
} from "./helpers";
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

        // Generate PDF
        const qrBuffer = await generateQRBuffer(`Overall Business Report | Net Assets: Rs ${fmtCurrency(estimatedNetBusinessValue)} | Receivables: Rs ${fmtCurrency(totalReceivables)} | Payables: Rs ${fmtCurrency(totalPayables)}`);

        const pdfGen = createPDFGenerator(
            pdfConfig(
                "Overall Business Executive Report",
                "Financial Position, P&L, Receivables, Payables & Asset Valuation",
                {
                    "Date Range": `${fromStr} to ${toStr}`,
                    "Net Sales": fmtCurrency(netSales),
                    "Net Profit": fmtCurrency(netOperatingProfit),
                    "Receivables": fmtCurrency(totalReceivables),
                    "Payables": fmtCurrency(totalPayables),
                },
                "portrait",
                "A4",
                qrBuffer
            )
        );

        const doc = pdfGen.getDocument();

        const sectionHeader = (title: string, color = "#1e293b") => {
            doc.x = doc.page.margins.left;
            doc.fontSize(10).fillColor(color).text(title);
            doc.moveDown(0.3);
        };

        // ── Executive KPI Summary Cards ──
        sectionHeader("Executive Summary & Financial Position", "#1e40af");

        doc.x = doc.page.margins.left;
        const kpiTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#1e3a8a", textColor: "#ffffff", fontSize: 9, fontStyle: "bold" } : { fontSize: 8.5 },
        });

        kpiTable.row([
            { text: "Metric", align: { x: "left", y: "center" } },
            { text: "Current Valuation", align: { x: "right", y: "center" } },
            { text: "Metric", align: { x: "left", y: "center" } },
            { text: "Current Valuation", align: { x: "right", y: "center" } },
        ]);

        kpiTable.row([
            { text: "Customer Receivables", align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(totalReceivables)}`, align: { x: "right", y: "center" } },
            { text: "Supplier Payables", align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(totalPayables)}`, align: { x: "right", y: "center" } },
        ]);

        kpiTable.row([
            { text: "Cash & Bank Balance", align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(totalCashAndBank)}`, align: { x: "right", y: "center" } },
            { text: "Inventory Stock Valuation", align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(totalInventoryValue)}`, align: { x: "right", y: "center" } },
        ]);

        kpiTable.row([
            { text: "Net Working Capital", align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(netWorkingCapital)}`, align: { x: "right", y: "center" } },
            { text: "Estimated Net Assets", align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(estimatedNetBusinessValue)}`, align: { x: "right", y: "center" } },
        ]);

        kpiTable.end();
        pdfGen.moveDown(0.4);

        // ── Profit & Loss Statement Section ──
        sectionHeader(`Profit & Loss Statement (${fromStr} to ${toStr})`, "#1e40af");

        doc.x = doc.page.margins.left;
        const pnlTable = doc.table({
            columnStyles: ["*", 100, "*", 100],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f1f5f9", fontSize: 9, fontStyle: "bold" } : { fontSize: 8.5 },
        });

        pnlTable.row([
            { text: "Income & Revenue Item", align: { x: "left", y: "center" } },
            { text: "Amount (Rs)", align: { x: "right", y: "center" } },
            { text: "Costs & Expense Item", align: { x: "left", y: "center" } },
            { text: "Amount (Rs)", align: { x: "right", y: "center" } },
        ]);

        pnlTable.row([
            { text: "Gross Sales Revenue", align: { x: "left", y: "center" } },
            { text: fmtCurrency(grossSales), align: { x: "right", y: "center" } },
            { text: "Cost of Goods Sold (COGS)", align: { x: "left", y: "center" } },
            { text: fmtCurrency(netCogs), align: { x: "right", y: "center" } },
        ]);

        pnlTable.row([
            { text: "Sales Returns (-)", align: { x: "left", y: "center" } },
            { text: `-${fmtCurrency(returnSales)}`, align: { x: "right", y: "center" } },
            { text: "Operating Expenses", align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDirectExpenses), align: { x: "right", y: "center" } },
        ]);

        pnlTable.row([
            { text: "Net Revenue", align: { x: "left", y: "center" } },
            { text: fmtCurrency(netSales), align: { x: "right", y: "center" } },
            { text: "Salaries / Payroll Paid", align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalSalaries), align: { x: "right", y: "center" } },
        ]);

        pnlTable.row([
            { text: `Gross Profit (${grossProfitMargin.toFixed(1)}%)`, align: { x: "left", y: "center" } },
            { text: fmtCurrency(grossProfit), align: { x: "right", y: "center" } },
            { text: "Net Operating Profit", align: { x: "left", y: "center" } },
            { text: fmtCurrency(netOperatingProfit), align: { x: "right", y: "center" } },
        ]);

        pnlTable.end();
        pdfGen.moveDown(0.4);

        // ── Receivables & Payables Highlights ──
        sectionHeader("Party Balances & Working Capital Position", "#1e40af");

        doc.x = doc.page.margins.left;
        const partyTable = doc.table({
            columnStyles: ["*", 80, 100, 90],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f1f5f9", fontSize: 9, fontStyle: "bold" } : { fontSize: 8.5 },
        });

        partyTable.row([
            { text: "Category", align: { x: "left", y: "center" } },
            { text: "Party Count", align: { x: "center", y: "center" } },
            { text: "Total Amount (Rs)", align: { x: "right", y: "center" } },
            { text: "Status / Note", align: { x: "center", y: "center" } },
        ]);

        partyTable.row([
            { text: "Accounts Receivable (Customers Owing)", align: { x: "left", y: "center" } },
            { text: String(receivableCustomersCount), align: { x: "center", y: "center" } },
            { text: fmtCurrency(totalReceivables), align: { x: "right", y: "center" } },
            { text: "Incoming Funds", align: { x: "center", y: "center" } },
        ]);

        partyTable.row([
            { text: "Accounts Payable (Suppliers Owed)", align: { x: "left", y: "center" } },
            { text: String(payableSuppliersCount), align: { x: "center", y: "center" } },
            { text: fmtCurrency(totalPayables), align: { x: "right", y: "center" } },
            { text: "Outgoing Liabilities", align: { x: "center", y: "center" } },
        ]);

        partyTable.row([
            { text: "Customer Advances / Overpaid", align: { x: "left", y: "center" } },
            { text: String(activeCustomers.length - receivableCustomersCount), align: { x: "center", y: "center" } },
            { text: fmtCurrency(totalOverpaidCustomers), align: { x: "right", y: "center" } },
            { text: "Customer Prepayments", align: { x: "center", y: "center" } },
        ]);

        partyTable.row([
            { text: "Supplier Advances Paid", align: { x: "left", y: "center" } },
            { text: String(activeSuppliers.length - payableSuppliersCount), align: { x: "center", y: "center" } },
            { text: fmtCurrency(totalAdvanceSuppliers), align: { x: "right", y: "center" } },
            { text: "Supplier Prepayments", align: { x: "center", y: "center" } },
        ]);

        partyTable.end();
        pdfGen.moveDown(0.4);

        // ── Top Receivables & Payables Tables ──
        sectionHeader("Top Outstanding Receivables & Payables", "#1e40af");

        const topCustomers = customerListWithBalances.filter(c => c.balance > 0).slice(0, 5);
        const topSuppliers = supplierListWithBalances.filter(s => s.balance > 0).slice(0, 5);

        doc.x = doc.page.margins.left;
        const sideTable = doc.table({
            columnStyles: ["*", 90, "*", 90],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#e2e8f0", fontSize: 8.5, fontStyle: "bold" } : { fontSize: 8 },
        });

        sideTable.row([
            { text: "Top Due Customers", align: { x: "left", y: "center" } },
            { text: "Receivable (Rs)", align: { x: "right", y: "center" } },
            { text: "Top Owed Suppliers", align: { x: "left", y: "center" } },
            { text: "Payable (Rs)", align: { x: "right", y: "center" } },
        ]);

        const maxRows = Math.max(topCustomers.length, topSuppliers.length, 1);
        for (let i = 0; i < maxRows; i++) {
            const cust = topCustomers[i];
            const supp = topSuppliers[i];
            sideTable.row([
                { text: cust ? `${i + 1}. ${cust.name}` : "—", align: { x: "left", y: "center" } },
                { text: cust ? fmtCurrency(cust.balance) : "—", align: { x: "right", y: "center" } },
                { text: supp ? `${i + 1}. ${supp.name}` : "—", align: { x: "left", y: "center" } },
                { text: supp ? fmtCurrency(supp.balance) : "—", align: { x: "right", y: "center" } },
            ]);
        }

        sideTable.end();
        pdfGen.moveDown(0.4);

        // ── Inventory & Assets Health Summary ──
        sectionHeader("Inventory & Liquid Assets Overview", "#1e40af");

        doc.x = doc.page.margins.left;
        const invTable = doc.table({
            columnStyles: ["*", 90, "*", 90],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f1f5f9", fontSize: 9, fontStyle: "bold" } : { fontSize: 8.5 },
        });

        invTable.row([
            { text: "Inventory Attribute", align: { x: "left", y: "center" } },
            { text: "Quantity / Value", align: { x: "right", y: "center" } },
            { text: "Liquid Accounts Attribute", align: { x: "left", y: "center" } },
            { text: "Value (Rs)", align: { x: "right", y: "center" } },
        ]);

        invTable.row([
            { text: "Total Active Products", align: { x: "left", y: "center" } },
            { text: products.length.toString(), align: { x: "right", y: "center" } },
            { text: "Total Cash & Bank Accounts", align: { x: "left", y: "center" } },
            { text: accounts.filter(a => a.type === 'ASSET').length.toString(), align: { x: "right", y: "center" } },
        ]);

        invTable.row([
            { text: "Total Stock Units", align: { x: "left", y: "center" } },
            { text: totalStockUnits.toString(), align: { x: "right", y: "center" } },
            { text: "Total Liquid Cash/Bank Funds", align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCashAndBank), align: { x: "right", y: "center" } },
        ]);

        invTable.row([
            { text: "Low / Reorder Stock Items", align: { x: "left", y: "center" } },
            { text: lowStockItems.toString(), align: { x: "right", y: "center" } },
            { text: "Stock Asset Valuation", align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalInventoryValue), align: { x: "right", y: "center" } },
        ]);

        invTable.row([
            { text: "Negative Stock Alerts", align: { x: "left", y: "center" } },
            { text: negativeStockItems.toString(), align: { x: "right", y: "center" } },
            { text: "Total Assets (Cash + Stock + Rec.)", align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCashAndBank + totalInventoryValue + totalReceivables), align: { x: "right", y: "center" } },
        ]);

        invTable.end();

        const pdfBuffer = await pdfGen.toBuffer();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="Overall_Business_Report_${fromStr}_to_${toStr}.pdf"`);
        res.send(pdfBuffer);
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

        const qrBuffer = await generateQRBuffer(`Payables & Receivables | Receivables: Rs ${fmtCurrency(totalReceivable)} | Payables: Rs ${fmtCurrency(totalPayable)} | Net: Rs ${fmtCurrency(netWorkingPosition)}`);

        const pdfGen = createPDFGenerator(
            pdfConfig(
                "Overall Receivables & Payables Summary",
                "Accounts Receivable (Customers) & Accounts Payable (Suppliers)",
                {
                    "Total Receivable": fmtCurrency(totalReceivable),
                    "Total Payable": fmtCurrency(totalPayable),
                    "Net Working Position": fmtCurrency(netWorkingPosition),
                },
                "landscape",
                "A4",
                qrBuffer
            )
        );

        const doc = pdfGen.getDocument();

        const sectionHeader = (title: string, color = "#1e293b") => {
            doc.x = doc.page.margins.left;
            doc.fontSize(10).fillColor(color).text(title);
            doc.moveDown(0.3);
        };

        // ── Summary KPI Bar ──
        sectionHeader("Summary Position", "#1e40af");

        doc.x = doc.page.margins.left;
        const kpiTable = doc.table({
            columnStyles: ["*", "*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#1e3a8a", textColor: "#ffffff", fontSize: 9, fontStyle: "bold" } : { fontSize: 8.5 },
        });

        kpiTable.row([
            { text: "Total Customers Due", align: { x: "center", y: "center" } },
            { text: "Total Customer Receivables", align: { x: "right", y: "center" } },
            { text: "Total Suppliers Due", align: { x: "center", y: "center" } },
            { text: "Total Supplier Payables", align: { x: "right", y: "center" } },
            { text: "Net Working Position", align: { x: "right", y: "center" } },
        ]);

        kpiTable.row([
            { text: customers.filter(c => c.balance > 0).length.toString(), align: { x: "center", y: "center" } },
            { text: `Rs ${fmtCurrency(totalReceivable)}`, align: { x: "right", y: "center" } },
            { text: suppliers.filter(s => s.balance > 0).length.toString(), align: { x: "center", y: "center" } },
            { text: `Rs ${fmtCurrency(totalPayable)}`, align: { x: "right", y: "center" } },
            { text: `Rs ${fmtCurrency(netWorkingPosition)}`, align: { x: "right", y: "center" } },
        ]);

        kpiTable.end();
        pdfGen.moveDown(0.4);

        // ── Customers Receivables Table ──
        sectionHeader("Accounts Receivable (Customers)", "#1e40af");

        doc.x = doc.page.margins.left;
        const custTable = doc.table({
            columnStyles: [30, "*", 90, 110, 90, 85],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#e2e8f0", fontSize: 8.5, fontStyle: "bold" } : { fontSize: 8 },
        });

        custTable.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Customer Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "center", y: "center" } },
            { text: "City", align: { x: "left", y: "center" } },
            { text: "Balance (Rs)", align: { x: "right", y: "center" } },
            { text: "Type", align: { x: "center", y: "center" } },
        ]);

        if (customers.length === 0) {
            custTable.row([
                { text: "—", align: { x: "center", y: "center" } },
                { text: "No outstanding customer balances", align: { x: "left", y: "center" } },
                { text: "—", align: { x: "center", y: "center" } },
                { text: "—", align: { x: "left", y: "center" } },
                { text: "0", align: { x: "right", y: "center" } },
                { text: "Clear", align: { x: "center", y: "center" } },
            ]);
        } else {
            customers.forEach((c, idx) => {
                custTable.row([
                    { text: String(idx + 1), align: { x: "center", y: "center" } },
                    { text: c.name, align: { x: "left", y: "center" } },
                    { text: c.phone ?? "N/A", align: { x: "center", y: "center" } },
                    { text: c.city ?? "N/A", align: { x: "left", y: "center" } },
                    { text: fmtCurrency(c.balance), align: { x: "right", y: "center" } },
                    { text: c.balance > 0 ? "Receivable" : "Prepaid", align: { x: "center", y: "center" } },
                ]);
            });
        }

        custTable.end();
        pdfGen.moveDown(0.4);

        // ── Suppliers Payables Table ──
        sectionHeader("Accounts Payable (Suppliers)", "#1e40af");

        doc.x = doc.page.margins.left;
        const suppTable = doc.table({
            columnStyles: [30, "*", 90, 110, 90, 85],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#e2e8f0", fontSize: 8.5, fontStyle: "bold" } : { fontSize: 8 },
        });

        suppTable.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Supplier Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "center", y: "center" } },
            { text: "City", align: { x: "left", y: "center" } },
            { text: "Balance (Rs)", align: { x: "right", y: "center" } },
            { text: "Type", align: { x: "center", y: "center" } },
        ]);

        if (suppliers.length === 0) {
            suppTable.row([
                { text: "—", align: { x: "center", y: "center" } },
                { text: "No outstanding supplier balances", align: { x: "left", y: "center" } },
                { text: "—", align: { x: "center", y: "center" } },
                { text: "—", align: { x: "left", y: "center" } },
                { text: "0", align: { x: "right", y: "center" } },
                { text: "Clear", align: { x: "center", y: "center" } },
            ]);
        } else {
            suppliers.forEach((s, idx) => {
                suppTable.row([
                    { text: String(idx + 1), align: { x: "center", y: "center" } },
                    { text: s.name, align: { x: "left", y: "center" } },
                    { text: s.phone ?? "N/A", align: { x: "center", y: "center" } },
                    { text: s.city ?? "N/A", align: { x: "left", y: "center" } },
                    { text: fmtCurrency(s.balance), align: { x: "right", y: "center" } },
                    { text: s.balance > 0 ? "Payable" : "Advance Paid", align: { x: "center", y: "center" } },
                ]);
            });
        }

        suppTable.end();

        const pdfBuffer = await pdfGen.toBuffer();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="Payables_and_Receivables_Summary.pdf"`);
        res.send(pdfBuffer);
    } catch (err) {
        console.error("Error generating payables and receivables report:", err);
        res.status(500).json({ error: "Failed to generate payables and receivables report" });
    }
};
