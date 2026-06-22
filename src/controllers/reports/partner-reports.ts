import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import { generateSignatureSection } from "../../utils/pdf/pdfkit-components";
import {
    fmtDate,
    fmtCurrency,
    pdfConfig,
    generateQRBuffer,
    createPDFGenerator,
    fonts,
    logoPath,
    readSettings
} from "./helpers";
import {
    computeCustomerBalance,
    computeSupplierBalance,
    computeAllCustomerBalances,
    computeAllSupplierBalances
} from "../../utils/balance";

export const getCustomerBalancesReportPDF = async (req: Request, res: Response): Promise<void> => {
    try {
        const activeCustomers = await prisma.customer.findMany({
            where: { active: true },
        });

        const balanceMap = await computeAllCustomerBalances();
        const customers = activeCustomers
            .map((c) => ({ ...c, balance: balanceMap.get(c.id) ?? 0 }))
            .filter((c) => c.balance !== 0)
            .sort((a, b) => b.balance - a.balance);

        const totalReceivable = customers.filter((c) => c.balance > 0).reduce((s, c) => s + c.balance, 0);
        const totalOverpaid = customers.filter((c) => c.balance < 0).reduce((s, c) => s + Math.abs(c.balance), 0);

        const rows = customers.map((c, i) => ({
            sno: i + 1,
            name: c.name,
            phone: c.phone ?? "N/A",
            address: c.address ?? "N/A",
            creditLimit: c.creditLimit ?? 0,
            balance: c.balance,
            status: c.balance > 0 ? "Receivable" : "Overpaid",
        }));

        const custQr = await generateQRBuffer(`Customer Balances | Customers: ${customers.length} | Receivable: ${fmtCurrency(totalReceivable)}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Customer Balances Report", "Accounts Receivable", {
                "Total Customers": customers.length,
                "Total Receivable": fmtCurrency(totalReceivable),
                "Total Overpaid": fmtCurrency(totalOverpaid),
            }, undefined, undefined, custQr)
        );
        const doc = pdfGen.getDocument();

        // Summary
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Customers", align: { x: "left", y: "center" } },
            { text: "Total Receivable", align: { x: "left", y: "center" } },
            { text: "Total Overpaid", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: customers.length.toString(), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalReceivable), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalOverpaid), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();

        pdfGen.moveDown(0.5);

        // Customer balances table — 7 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, "*", 85, 110, 85, 90, 75],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Customer Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "center", y: "center" } },
            { text: "Address", align: { x: "left", y: "center" } },
            { text: "Credit Limit", align: { x: "right", y: "center" } },
            { text: "Balance", align: { x: "right", y: "center" } },
            { text: "Status", align: { x: "center", y: "center" } },
        ]);
        rows.forEach((row) => {
            table.row([
                { text: String(row.sno), align: { x: "center", y: "center" } },
                { text: row.name, align: { x: "left", y: "center" } },
                { text: row.phone, align: { x: "center", y: "center" } },
                { text: row.address, align: { x: "left", y: "center" } },
                { text: row.creditLimit > 0 ? fmtCurrency(row.creditLimit) : "No Limit", align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.balance), align: { x: "right", y: "center" } },
                { text: row.status, align: { x: "center", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Grand Total", colSpan: 5, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalReceivable - totalOverpaid), align: { x: "right", y: "center" } },
            { text: "", align: { x: "center", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `customer-balances-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Customer balances PDF error:", error);
        res.status(500).json({ error: "Failed to generate customer balances report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

export const getSupplierBalancesReportPDF = async (req: Request, res: Response): Promise<void> => {
    try {
        const activeSuppliers = await prisma.supplier.findMany({
            where: { active: true },
        });

        const balanceMap = await computeAllSupplierBalances();
        const suppliers = activeSuppliers
            .map((s) => ({ ...s, balance: balanceMap.get(s.id) ?? 0 }))
            .filter((s) => s.balance !== 0)
            .sort((a, b) => b.balance - a.balance);

        const totalPayable = suppliers.filter((s) => s.balance > 0).reduce((s, sup) => s + sup.balance, 0);
        const totalOverpaid = suppliers.filter((s) => s.balance < 0).reduce((s, sup) => s + Math.abs(sup.balance), 0);

        const rows = suppliers.map((s, i) => ({
            sno: i + 1,
            name: s.name,
            phone: s.phone ?? "N/A",
            paymentTerms: s.paymentTerms ?? "N/A",
            taxId: s.taxId ?? "N/A",
            balance: s.balance,
            status: s.balance > 0 ? "Payable" : "Overpaid",
        }));

        const suppQr = await generateQRBuffer(`Supplier Balances | Suppliers: ${suppliers.length} | Payable: ${fmtCurrency(totalPayable)}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Supplier Balances Report", "Accounts Payable", {
                "Total Suppliers": suppliers.length,
                "Total Payable": fmtCurrency(totalPayable),
                "Total Overpaid": fmtCurrency(totalOverpaid),
            }, undefined, undefined, suppQr)
        );
        const doc = pdfGen.getDocument();

        // Summary
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Suppliers", align: { x: "left", y: "center" } },
            { text: "Total Payable", align: { x: "left", y: "center" } },
            { text: "Total Overpaid", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: suppliers.length.toString(), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalPayable), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalOverpaid), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();

        pdfGen.moveDown(0.5);

        // Supplier balances table — 7 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, "*", 85, 100, 90, 90, 70],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Supplier Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "center", y: "center" } },
            { text: "Payment Terms", align: { x: "left", y: "center" } },
            { text: "Tax ID", align: { x: "center", y: "center" } },
            { text: "Balance", align: { x: "right", y: "center" } },
            { text: "Status", align: { x: "center", y: "center" } },
        ]);
        rows.forEach((row) => {
            table.row([
                { text: String(row.sno), align: { x: "center", y: "center" } },
                { text: row.name, align: { x: "left", y: "center" } },
                { text: row.phone, align: { x: "center", y: "center" } },
                { text: row.paymentTerms, align: { x: "left", y: "center" } },
                { text: row.taxId, align: { x: "center", y: "center" } },
                { text: fmtCurrency(row.balance), align: { x: "right", y: "center" } },
                { text: row.status, align: { x: "center", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Grand Total", colSpan: 5, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalPayable - totalOverpaid), align: { x: "right", y: "center" } },
            { text: "", align: { x: "center", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `supplier-balances-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Supplier balances PDF error:", error);
        res.status(500).json({ error: "Failed to generate supplier balances report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

export const getCustomerStatementPDF = async (req: Request, res: Response): Promise<void> => {
    const customerId = Number(req.params.customerId);
    const { from, to } = req.query;

    try {
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) { res.status(404).json({ message: "Customer not found" }); return; }

        const ledgerWhere: any = { customerId };
        if (from) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, gte: new Date(`${from}T00:00:00.000`) };
        if (to) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, lte: new Date(`${to}T23:59:59.999`) };

        const ledgerEntries = await prisma.customerLedger.findMany({
            where: ledgerWhere,
            orderBy: { createdAt: "asc" },
        });

        let openingBalance = 0;
        if (from) {
            const aggBefore = await prisma.customerLedger.aggregate({
                where: {
                    customerId,
                    createdAt: { lt: new Date(`${from}T00:00:00.000`) },
                },
                _sum: { debit: true, credit: true },
            });
            openingBalance = (aggBefore._sum.debit ?? 0) - (aggBefore._sum.credit ?? 0);
        }

        // Determine debit/credit direction by type
        const debitTypes = ["SALE", "ADJUSTMENT_DR"];
        let runningBalance = openingBalance;
        const ledgerRows = ledgerEntries.map((entry) => {
            const isDebit = debitTypes.includes(entry.type);
            const debit = isDebit ? entry.amount : 0;
            const credit = !isDebit ? entry.amount : 0;
            runningBalance += debit - credit;
            return { ...entry, debit, credit, runningBalance };
        });

        const totalDebit = ledgerRows.reduce((s, r) => s + r.debit, 0);
        const totalCredit = ledgerRows.reduce((s, r) => s + r.credit, 0);
        const closingBalance = runningBalance;

        // Total sales and payments in period
        const salesCount = ledgerEntries.filter((e) => e.type === "SALE").length;
        const paymentsCount = ledgerEntries.filter((e) => e.type === "PAYMENT").length;

        const reportFonts = fonts();
        const company = readSettings();
        const pdfGen = createPDFGenerator({
            fontRegistrations: reportFonts.registrations,
            fontFamilyMap: reportFonts.aliasMap,
            pdfOptions: {
                size: "A4",
                margins: { top: 10, bottom: 10, left: 20, right: 20 },
            },
            header: {
                title: "Customer Account Statement",
                subtitle: `Customer: ${customer.name}`,
                logo: { path: logoPath, width: 60, height: 60 },
                companyName: (company.businessName as string) || undefined,
                address: (company.address as string) || undefined,
                phone: (company.phone as string) || undefined,
                showDate: true,
                titleFont: { size: 16 },
                subtitleFont: { size: 10, color: "#666666" },
                filterInfo: {
                    "From": from ? fmtDate(from as string) : "All",
                    "To": to ? fmtDate(to as string) : "Now",
                },
            },
            footer: {
                leftText: (company.businessName as string) || "POS System",
                centerText: "Customer Statement",
                showPageNumber: true,
                font: { size: 8, color: "#666666" },
            },
        });

        const doc = pdfGen.getDocument();

        // Customer info
        doc.x = doc.page.margins.left;
        const infoTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        infoTable.row([
            { text: "Customer Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "left", y: "center" } },
            { text: "Address", align: { x: "left", y: "center" } },
            { text: "Credit Limit", align: { x: "left", y: "center" } },
        ]);
        infoTable.row([
            { text: customer.name, align: { x: "left", y: "center" } },
            { text: customer.phone ?? "N/A", align: { x: "left", y: "center" } },
            { text: customer.address ?? "N/A", align: { x: "left", y: "center" } },
            { text: customer.creditLimit != null ? fmtCurrency(customer.creditLimit) : "No Limit", align: { x: "left", y: "center" } },
        ]);
        infoTable.end();

        pdfGen.moveDown(0.4);

        // Account summary
        doc.x = doc.page.margins.left;
        const acctTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        acctTable.row([
            { text: "Total Invoiced", align: { x: "left", y: "center" } },
            { text: "Total Paid", align: { x: "left", y: "center" } },
            { text: "Closing Balance", align: { x: "left", y: "center" } },
            { text: "Transactions", align: { x: "left", y: "center" } },
        ]);
        acctTable.row([
            { text: fmtCurrency(totalDebit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "left", y: "center" } },
            { text: `${salesCount} sales, ${paymentsCount} payments`, align: { x: "left", y: "center" } },
        ]);
        acctTable.end();

        pdfGen.moveDown(0.5);

        // Ledger table — 6 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [80, 90, "*", 80, 80, 85],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Type", align: { x: "center", y: "center" } },
            { text: "Reference / Note", align: { x: "left", y: "center" } },
            { text: "Debit", align: { x: "right", y: "center" } },
            { text: "Credit", align: { x: "right", y: "center" } },
            { text: "Balance", align: { x: "right", y: "center" } },
        ]);
        ledgerRows.forEach((row) => {
            table.row([
                { text: fmtDate(row.createdAt, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: row.type.replace(/_/g, " "), align: { x: "center", y: "center" } },
                { text: row.reference ?? row.note ?? "-", align: { x: "left", y: "center" } },
                { text: row.debit ? fmtCurrency(row.debit) : "-", align: { x: "right", y: "center" } },
                { text: row.credit ? fmtCurrency(row.credit) : "-", align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.runningBalance), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Total", colSpan: 3, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "right", y: "center" } },
        ]);
        table.end();

        pdfGen.moveDown(1);

        generateSignatureSection(doc, {
            signatures: [
                { label: "Customer Signature", name: "_________________", title: customer.name },
                { label: "Accountant", name: "_________________", title: "Accounts Dept." },
                { label: "Manager", name: "_________________", title: "General Manager" },
            ],
            spacing: 30,
            lineWidth: 120,
            labelFont: { family: "Helvetica-Bold", size: 8 },
            nameFont: { size: 9 },
        });

        await pdfGen.sendToResponse(res, `customer-statement-${customer.name}-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Customer statement PDF error:", error);
        res.status(500).json({ error: "Failed to generate customer statement PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

export const getSupplierStatementPDF = async (req: Request, res: Response): Promise<void> => {
    const supplierId = Number(req.params.supplierId);
    const { from, to } = req.query;

    try {
        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) { res.status(404).json({ message: "Supplier not found" }); return; }

        const ledgerWhere: any = { supplierId };
        if (from) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, gte: new Date(`${from}T00:00:00.000`) };
        if (to) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, lte: new Date(`${to}T23:59:59.999`) };

        const ledgerEntries = await prisma.supplierLedger.findMany({
            where: ledgerWhere,
            orderBy: { createdAt: "asc" },
        });

        let openingBalance = 0;
        if (from) {
            const aggBefore = await prisma.supplierLedger.aggregate({
                where: {
                    supplierId,
                    createdAt: { lt: new Date(`${from}T00:00:00.000`) },
                },
                _sum: { debit: true, credit: true },
            });
            openingBalance = (aggBefore._sum.debit ?? 0) - (aggBefore._sum.credit ?? 0);
        }

        // Debit types increase what we owe; credit types decrease it
        const debitTypes = ["PURCHASE", "ADJUSTMENT_DR"];
        let runningBalance = openingBalance;
        const ledgerRows = ledgerEntries.map((entry) => {
            const isDebit = debitTypes.includes(entry.type);
            const debit = isDebit ? entry.amount : 0;
            const credit = !isDebit ? entry.amount : 0;
            runningBalance += debit - credit;
            return { ...entry, debit, credit, runningBalance };
        });

        const totalDebit = ledgerRows.reduce((s, r) => s + r.debit, 0);
        const totalCredit = ledgerRows.reduce((s, r) => s + r.credit, 0);
        const closingBalance = runningBalance;

        const purchasesCount = ledgerEntries.filter((e) => e.type === "PURCHASE").length;
        const paymentsCount = ledgerEntries.filter((e) => e.type === "PAYMENT").length;

        const reportFonts = fonts();
        const company = readSettings();
        const pdfGen = createPDFGenerator({
            fontRegistrations: reportFonts.registrations,
            fontFamilyMap: reportFonts.aliasMap,
            pdfOptions: {
                size: "A4",
                margins: { top: 10, bottom: 10, left: 20, right: 20 },
            },
            header: {
                title: "Supplier Account Statement",
                subtitle: `Supplier: ${supplier.name}`,
                logo: { path: logoPath, width: 60, height: 60 },
                companyName: (company.businessName as string) || undefined,
                address: (company.address as string) || undefined,
                phone: (company.phone as string) || undefined,
                showDate: true,
                titleFont: { family: "Helvetica-Bold" as const, size: 16 },
                subtitleFont: { size: 10, color: "#666666" },
                filterInfo: {
                    "From": from ? fmtDate(from as string) : "All",
                    "To": to ? fmtDate(to as string) : "Now",
                },
            },
            footer: {
                leftText: (company.businessName as string) || "POS System",
                centerText: "Supplier Statement",
                showPageNumber: true,
                font: { size: 8, color: "#666666" },
            },
        });

        const doc = pdfGen.getDocument();

        // Supplier info
        doc.x = doc.page.margins.left;
        const infoTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        infoTable.row([
            { text: "Supplier Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "left", y: "center" } },
            { text: "Payment Terms", align: { x: "left", y: "center" } },
            { text: "Tax ID", align: { x: "left", y: "center" } },
        ]);
        infoTable.row([
            { text: supplier.name, align: { x: "left", y: "center" } },
            { text: supplier.phone ?? "N/A", align: { x: "left", y: "center" } },
            { text: supplier.paymentTerms ?? "N/A", align: { x: "left", y: "center" } },
            { text: supplier.taxId ?? "N/A", align: { x: "left", y: "center" } },
        ]);
        infoTable.end();

        pdfGen.moveDown(0.4);

        // Account summary
        doc.x = doc.page.margins.left;
        const acctTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        acctTable.row([
            { text: "Total Purchases", align: { x: "left", y: "center" } },
            { text: "Total Paid", align: { x: "left", y: "center" } },
            { text: "Closing Balance", align: { x: "left", y: "center" } },
            { text: "Transactions", align: { x: "left", y: "center" } },
        ]);
        acctTable.row([
            { text: fmtCurrency(totalDebit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "left", y: "center" } },
            { text: `${purchasesCount} purchases, ${paymentsCount} payments`, align: { x: "left", y: "center" } },
        ]);
        acctTable.end();

        pdfGen.moveDown(0.5);

        // Ledger table — 6 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [80, 90, "*", 80, 80, 85],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Type", align: { x: "center", y: "center" } },
            { text: "Reference / Note", align: { x: "left", y: "center" } },
            { text: "Debit", align: { x: "right", y: "center" } },
            { text: "Credit", align: { x: "right", y: "center" } },
            { text: "Balance", align: { x: "right", y: "center" } },
        ]);
        ledgerRows.forEach((row) => {
            table.row([
                { text: fmtDate(row.createdAt, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: row.type.replace(/_/g, " "), align: { x: "center", y: "center" } },
                { text: row.reference ?? row.note ?? "-", align: { x: "left", y: "center" } },
                { text: row.debit ? fmtCurrency(row.debit) : "-", align: { x: "right", y: "center" } },
                { text: row.credit ? fmtCurrency(row.credit) : "-", align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.runningBalance), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Total", colSpan: 3, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "right", y: "center" } },
        ]);
        table.end();

        pdfGen.moveDown(1);

        generateSignatureSection(doc, {
            signatures: [
                { label: "Supplier Signature", name: "_________________", title: supplier.name },
                { label: "Accountant", name: "_________________", title: "Accounts Dept." },
                { label: "Manager", name: "_________________", title: "General Manager" },
            ],
            spacing: 30,
            lineWidth: 120,
            labelFont: { family: "Helvetica-Bold", size: 8 },
            nameFont: { size: 9 },
        });

        await pdfGen.sendToResponse(res, `supplier-statement-${supplier.name}-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Supplier statement PDF error:", error);
        res.status(500).json({ error: "Failed to generate supplier statement PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

export const getCustomerLedgerReportPDF = async (req: Request, res: Response): Promise<void> => {
    const customerId = Number(req.params.customerId);
    const { from, to } = req.query;

    try {
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) { res.status(404).json({ message: "Customer not found" }); return; }

        const ledgerWhere: any = { customerId };
        if (from) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, gte: new Date(`${from}T00:00:00.000`) };
        if (to) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, lte: new Date(`${to}T23:59:59.999`) };

        const entries = await prisma.customerLedger.findMany({
            where: ledgerWhere,
            orderBy: { createdAt: "asc" },
        });

        // Calculate opening balance: balance of the last entry BEFORE the date range
        let openingBalance = 0;
        if (from) {
            const aggBefore = await prisma.customerLedger.aggregate({
                where: {
                    customerId,
                    createdAt: { lt: new Date(`${from}T00:00:00.000`) },
                },
                _sum: { debit: true, credit: true },
            });
            openingBalance = (aggBefore._sum.debit ?? 0) - (aggBefore._sum.credit ?? 0);
        }

        const debitTypes = ["SALE", "ADJUSTMENT_DR"];

        let totalDebit = 0;
        let totalCredit = 0;
        let runningBalance = openingBalance;
        const ledgerRows = entries.map((entry) => {
            const debit = entry.debit || (debitTypes.includes(entry.type) ? entry.amount : 0);
            const credit = entry.credit || (!debitTypes.includes(entry.type) ? entry.amount : 0);
            totalDebit += debit;
            totalCredit += credit;
            runningBalance += debit - credit;
            return { ...entry, debit, credit, balance: runningBalance };
        });
        const closingBalance = runningBalance;

        const reportFonts = fonts();
        const company = readSettings();
        const pdfGen = createPDFGenerator({
            fontRegistrations: reportFonts.registrations,
            fontFamilyMap: reportFonts.aliasMap,
            pdfOptions: { size: "A4", margins: { top: 10, bottom: 10, left: 20, right: 20 } },
            header: {
                title: "Customer Ledger Report",
                subtitle: `Customer: ${customer.name}`,
                logo: { path: logoPath, width: 60, height: 60 },
                companyName: (company.businessName as string) || undefined,
                address: (company.address as string) || undefined,
                phone: (company.phone as string) || undefined,
                showDate: true,
                titleFont: { size: 16 },
                subtitleFont: { size: 10, color: "#666666" },
                filterInfo: {
                    "From": from ? fmtDate(from as string) : "All",
                    "To": to ? fmtDate(to as string) : "Now",
                },
            },
            footer: {
                leftText: (company.businessName as string) || "POS System",
                centerText: "Customer Ledger",
                showPageNumber: true,
                font: { size: 8, color: "#666666" },
            },
        });
        const doc = pdfGen.getDocument();

        // Customer info
        doc.x = doc.page.margins.left;
        const infoTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        infoTable.row([
            { text: "Customer Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "left", y: "center" } },
            { text: "Address", align: { x: "left", y: "center" } },
            { text: "Credit Limit", align: { x: "left", y: "center" } },
        ]);
        infoTable.row([
            { text: customer.name, align: { x: "left", y: "center" } },
            { text: customer.phone ?? "N/A", align: { x: "left", y: "center" } },
            { text: customer.address ?? "N/A", align: { x: "left", y: "center" } },
            { text: customer.creditLimit != null ? fmtCurrency(customer.creditLimit) : "No Limit", align: { x: "left", y: "center" } },
        ]);
        infoTable.end();

        pdfGen.moveDown(0.4);

        // Account summary
        doc.x = doc.page.margins.left;
        const acctTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        acctTable.row([
            { text: "Opening Balance", align: { x: "left", y: "center" } },
            { text: "Total Debit", align: { x: "left", y: "center" } },
            { text: "Total Credit", align: { x: "left", y: "center" } },
            { text: "Closing Balance", align: { x: "left", y: "center" } },
        ]);
        acctTable.row([
            { text: fmtCurrency(openingBalance), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "left", y: "center" } },
        ]);
        acctTable.end();

        pdfGen.moveDown(0.5);

        // Ledger table
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [80, 90, "*", 80, 80, 85],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Type", align: { x: "center", y: "center" } },
            { text: "Reference / Note", align: { x: "left", y: "center" } },
            { text: "Debit", align: { x: "right", y: "center" } },
            { text: "Credit", align: { x: "right", y: "center" } },
            { text: "Balance", align: { x: "right", y: "center" } },
        ]);
        // Opening balance row
        if (from) {
            table.row([
                { text: fmtDate(from as string, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: "OPENING BAL", align: { x: "center", y: "center" } },
                { text: "Opening Balance", align: { x: "left", y: "center" } },
                { text: "-", align: { x: "right", y: "center" } },
                { text: "-", align: { x: "right", y: "center" } },
                { text: fmtCurrency(openingBalance), align: { x: "right", y: "center" } },
            ]);
        }
        ledgerRows.forEach((row) => {
            table.row([
                { text: fmtDate(row.createdAt, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: row.type.replace(/_/g, " "), align: { x: "center", y: "center" } },
                { text: row.reference ?? row.note ?? "-", align: { x: "left", y: "center" } },
                { text: row.debit ? fmtCurrency(row.debit) : "-", align: { x: "right", y: "center" } },
                { text: row.credit ? fmtCurrency(row.credit) : "-", align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.balance), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Total", colSpan: 3, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "right", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `customer-ledger-${customer.name}-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Customer ledger report PDF error:", error);
        res.status(500).json({ error: "Failed to generate customer ledger report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

export const getSupplierLedgerReportPDF = async (req: Request, res: Response): Promise<void> => {
    const supplierId = Number(req.params.supplierId);
    const { from, to } = req.query;

    try {
        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) { res.status(404).json({ message: "Supplier not found" }); return; }

        const ledgerWhere: any = { supplierId };
        if (from) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, gte: new Date(`${from}T00:00:00.000`) };
        if (to) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, lte: new Date(`${to}T23:59:59.999`) };

        const entries = await prisma.supplierLedger.findMany({
            where: ledgerWhere,
            orderBy: { createdAt: "asc" },
        });

        // Calculate opening balance: balance of the last entry BEFORE the date range
        let openingBalance = 0;
        if (from) {
            const aggBefore = await prisma.supplierLedger.aggregate({
                where: {
                    supplierId,
                    createdAt: { lt: new Date(`${from}T00:00:00.000`) },
                },
                _sum: { debit: true, credit: true },
            });
            openingBalance = (aggBefore._sum.debit ?? 0) - (aggBefore._sum.credit ?? 0);
        }

        const debitTypes = ["PURCHASE", "ADJUSTMENT_DR"];

        let totalDebit = 0;
        let totalCredit = 0;
        let runningBalance = openingBalance;
        const ledgerRows = entries.map((entry) => {
            const debit = entry.debit || (debitTypes.includes(entry.type) ? entry.amount : 0);
            const credit = entry.credit || (!debitTypes.includes(entry.type) ? entry.amount : 0);
            totalDebit += debit;
            totalCredit += credit;
            runningBalance += debit - credit;
            return { ...entry, debit, credit, balance: runningBalance };
        });
        const closingBalance = runningBalance;

        const reportFonts = fonts();
        const company = readSettings();
        const pdfGen = createPDFGenerator({
            fontRegistrations: reportFonts.registrations,
            fontFamilyMap: reportFonts.aliasMap,
            pdfOptions: { size: "A4", margins: { top: 10, bottom: 10, left: 20, right: 20 } },
            header: {
                title: "Supplier Ledger Report",
                subtitle: `Supplier: ${supplier.name}`,
                logo: { path: logoPath, width: 60, height: 60 },
                companyName: (company.businessName as string) || undefined,
                address: (company.address as string) || undefined,
                phone: (company.phone as string) || undefined,
                showDate: true,
                titleFont: { family: "Helvetica-Bold" as const, size: 16 },
                subtitleFont: { size: 10, color: "#666666" },
                filterInfo: {
                    "From": from ? fmtDate(from as string) : "All",
                    "To": to ? fmtDate(to as string) : "Now",
                },
            },
            footer: {
                leftText: (company.businessName as string) || "POS System",
                centerText: "Supplier Ledger",
                showPageNumber: true,
                font: { size: 8, color: "#666666" },
            },
        });
        const doc = pdfGen.getDocument();

        // Supplier info
        doc.x = doc.page.margins.left;
        const infoTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        infoTable.row([
            { text: "Supplier Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "left", y: "center" } },
            { text: "Payment Terms", align: { x: "left", y: "center" } },
            { text: "Tax ID", align: { x: "left", y: "center" } },
        ]);
        infoTable.row([
            { text: supplier.name, align: { x: "left", y: "center" } },
            { text: supplier.phone ?? "N/A", align: { x: "left", y: "center" } },
            { text: supplier.paymentTerms ?? "N/A", align: { x: "left", y: "center" } },
            { text: supplier.taxId ?? "N/A", align: { x: "left", y: "center" } },
        ]);
        infoTable.end();

        pdfGen.moveDown(0.4);

        // Account summary
        doc.x = doc.page.margins.left;
        const acctTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        acctTable.row([
            { text: "Opening Balance", align: { x: "left", y: "center" } },
            { text: "Total Debit", align: { x: "left", y: "center" } },
            { text: "Total Credit", align: { x: "left", y: "center" } },
            { text: "Closing Balance", align: { x: "left", y: "center" } },
        ]);
        acctTable.row([
            { text: fmtCurrency(openingBalance), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "left", y: "center" } },
        ]);
        acctTable.end();

        pdfGen.moveDown(0.5);

        // Ledger table
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [80, 90, "*", 80, 80, 85],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Type", align: { x: "center", y: "center" } },
            { text: "Reference / Note", align: { x: "left", y: "center" } },
            { text: "Debit", align: { x: "right", y: "center" } },
            { text: "Credit", align: { x: "right", y: "center" } },
            { text: "Balance", align: { x: "right", y: "center" } },
        ]);
        // Opening balance row
        if (from && openingBalance !== 0) {
            table.row([
                { text: fmtDate(from as string, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: "OPENING BAL", align: { x: "center", y: "center" } },
                { text: "Opening Balance", align: { x: "left", y: "center" } },
                { text: "-", align: { x: "right", y: "center" } },
                { text: "-", align: { x: "right", y: "center" } },
                { text: fmtCurrency(openingBalance), align: { x: "right", y: "center" } },
            ]);
        }
        ledgerRows.forEach((row) => {
            table.row([
                { text: fmtDate(row.createdAt, "DD-MM-YYYY hh:mm:A"), align: { x: "center", y: "center" } },
                { text: row.type.replace(/_/g, " "), align: { x: "center", y: "center" } },
                { text: row.reference ?? row.note ?? "-", align: { x: "left", y: "center" } },
                { text: row.debit ? fmtCurrency(row.debit) : "-", align: { x: "right", y: "center" } },
                { text: row.credit ? fmtCurrency(row.credit) : "-", align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.balance), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Total", colSpan: 3, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "right", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `supplier-ledger-${supplier.name}-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Supplier ledger report PDF error:", error);
        res.status(500).json({ error: "Failed to generate supplier ledger report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
