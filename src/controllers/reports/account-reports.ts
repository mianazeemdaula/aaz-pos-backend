import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import { generateSignatureSection } from "../../utils/pdf/pdfkit-components";
import {
    fmtDate,
    fmtCurrency,
    pdfConfig,
    createPDFGenerator,
    fonts,
    logoPath,
    readSettings
} from "./helpers";

export const getAccountStatementPDF = async (req: Request, res: Response): Promise<void> => {
    const accountId = Number(req.params.accountId);
    const { from, to } = req.query;

    if (isNaN(accountId)) { res.status(400).json({ error: "Invalid account id" }); return; }

    const dateFrom = from ? new Date(`${from}T00:00:00.000`) : undefined;
    const dateTo = to ? new Date(`${to}T23:59:59.999`) : undefined;

    try {
        const account = await prisma.account.findUnique({ where: { id: accountId } });
        if (!account) { res.status(404).json({ error: "Account not found" }); return; }

        // Helper to build a date-range where clause for different field names
        const tsRange = (field: "createdAt" | "date" = "createdAt") => {
            const where: any = {};
            if (dateFrom) where[field] = { ...where[field], gte: dateFrom };
            if (dateTo) where[field] = { ...where[field], lte: dateTo };
            return where;
        };
        const tsRangeRaw = (field: string) => {
            const where: any = {};
            if (dateFrom) where[field] = { ...where[field], gte: dateFrom };
            if (dateTo) where[field] = { ...where[field], lte: dateTo };
            return where;
        };

        // Fetch all transaction types that reference this account
        const [
            salePayments,
            customerPayments,
            supplierPayments,
            purchasePayments,
            expenses,
            salarySlips,
            employeeAdvances,
        ] = await Promise.all([
            prisma.salePayment.findMany({
                where: { accountId, ...tsRange("createdAt") },
                orderBy: { createdAt: "asc" },
                select: {
                    id: true, saleId: true, amount: true, note: true, createdAt: true,
                    sale: { select: { id: true, customer: { select: { name: true } } } }
                },
            }),
            prisma.customerPayment.findMany({
                where: { accountId, ...tsRange("date") },
                orderBy: { date: "asc" },
                select: {
                    id: true, amount: true, note: true, date: true, type: true,
                    customer: { select: { name: true } }
                },
            }),
            prisma.supplierPayment.findMany({
                where: { accountId, ...tsRange("date") },
                orderBy: { date: "asc" },
                select: {
                    id: true, amount: true, note: true, date: true, type: true,
                    supplier: { select: { name: true } }
                },
            }),
            prisma.purchasePayment.findMany({
                where: { accountId, ...tsRange("createdAt") },
                orderBy: { createdAt: "asc" },
                select: {
                    id: true, purchaseId: true, amount: true, note: true, createdAt: true,
                    purchase: { select: { id: true, invoiceNo: true, supplier: { select: { name: true } } } }
                },
            }),
            prisma.expense.findMany({
                where: { accountId, ...tsRange("date") },
                orderBy: { date: "asc" },
                select: { id: true, description: true, category: true, amount: true, date: true },
            }),
            prisma.salarySlip.findMany({
                where: { accountId, status: "PAID", ...tsRangeRaw("paidDate") },
                orderBy: { paidDate: "asc" },
                select: {
                    id: true, year: true, month: true, netPayable: true, paidDate: true,
                    employee: { select: { name: true } }
                },
            }),
            prisma.employeeAdvance.findMany({
                where: { accountId, ...tsRange("date") },
                orderBy: { date: "asc" },
                select: {
                    id: true, amount: true, reason: true, date: true,
                    employee: { select: { name: true } }
                },
            }),
        ]);

        // ── Build a unified entry list with sign (CASH IN = +, CASH OUT = -)
        type TxEntry = { date: Date; type: string; reference: string; description: string; debit: number; credit: number };
        const entries: TxEntry[] = [];

        for (const sp of salePayments) {
            const isRefund = sp.amount < 0;
            entries.push({
                date: sp.createdAt,
                type: isRefund ? "Sale Refund" : "Sale Payment",
                reference: `INV-${sp.saleId}`,
                description: sp.sale.customer?.name ?? "Walk-in",
                debit: isRefund ? 0 : sp.amount,
                credit: isRefund ? Math.abs(sp.amount) : 0,
            });
        }
        for (const cp of customerPayments) {
            const isSent = cp.type === "SENT";
            entries.push({
                date: cp.date,
                type: isSent ? "Customer Refund" : "Customer Payment",
                reference: `CUST-PMT-${cp.id}`,
                description: cp.customer.name + (cp.note ? ` — ${cp.note}` : ""),
                debit: isSent ? 0 : cp.amount,
                credit: isSent ? cp.amount : 0,
            });
        }
        for (const sp of supplierPayments) {
            const isReceived = sp.type === "RECEIVED";
            entries.push({
                date: sp.date,
                type: isReceived ? "Supplier Refund" : "Supplier Payment",
                reference: `SUPP-PMT-${sp.id}`,
                description: sp.supplier.name + (sp.note ? ` — ${sp.note}` : ""),
                debit: isReceived ? sp.amount : 0,
                credit: isReceived ? 0 : sp.amount,
            });
        }
        for (const pp of purchasePayments) {
            const isRefund = pp.amount < 0;
            entries.push({
                date: pp.createdAt,
                type: isRefund ? "Purchase Refund" : "Purchase Payment",
                reference: pp.purchase.invoiceNo ?? `PO-${pp.purchaseId}`,
                description: pp.purchase.supplier?.name ?? "N/A",
                debit: isRefund ? Math.abs(pp.amount) : 0,  // money in if refund
                credit: isRefund ? 0 : pp.amount,           // money out if payment
            });
        }
        for (const ex of expenses) {
            entries.push({
                date: ex.date,
                type: `Expense (${ex.category})`,
                reference: `EXP-${ex.id}`,
                description: ex.description,
                debit: 0,
                credit: ex.amount,  // money out
            });
        }
        for (const sl of salarySlips) {
            const empName = sl.employee.name;
            entries.push({
                date: sl.paidDate ?? new Date(sl.year, sl.month - 1),
                type: "Salary",
                reference: `SAL-${sl.year}-${String(sl.month).padStart(2, "0")}`,
                description: empName,
                debit: 0,
                credit: sl.netPayable,  // money out
            });
        }
        for (const ea of employeeAdvances) {
            entries.push({
                date: ea.date,
                type: "Employee Advance",
                reference: `ADV-${ea.id}`,
                description: ea.employee.name + (ea.reason ? ` — ${ea.reason}` : ""),
                debit: 0,
                credit: ea.amount,  // money out
            });
        }
        // Sort chronologically
        entries.sort((a, b) => a.date.getTime() - b.date.getTime());

        const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
        const totalCredit = entries.reduce((s, e) => s + e.credit, 0);
        const netBalance = totalDebit - totalCredit;

        // PDF
        const reportFonts = fonts();
        const company = readSettings();
        const pdfGen = createPDFGenerator({
            fontRegistrations: reportFonts.registrations,
            fontFamilyMap: reportFonts.aliasMap,
            pdfOptions: {
                size: "A4",
                orientation: "landscape",
                margins: { top: 10, bottom: 10, left: 20, right: 20 },
            },
            header: {
                title: "Account Statement",
                subtitle: `${account.code} — ${account.name} (${account.type})`,
                logo: { path: logoPath, width: 60, height: 60 },
                companyName: (company.businessName as string) || undefined,
                address: (company.address as string) || undefined,
                phone: (company.phone as string) || undefined,
                showDate: true,
                titleFont: { family: "Helvetica-Bold" as const, size: 16 },
                subtitleFont: { size: 10, color: "#666666" },
                filterInfo: {
                    "Account": `${account.code} / ${account.name}`,
                    "Type": account.type,
                    "From": from ? fmtDate(from as string) : "All Time",
                    "To": to ? fmtDate(to as string) : "Now",
                    "Entries": entries.length,
                },
            },
            footer: {
                leftText: (company.businessName as string) || "POS System",
                centerText: "Account Statement",
                showPageNumber: true,
                font: { size: 8, color: "#666666" },
            },
        });

        const doc = pdfGen.getDocument();

        // Summary bar
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Debit (IN)", align: { x: "left", y: "center" } },
            { text: "Total Credit (OUT)", align: { x: "left", y: "center" } },
            { text: "Net Balance", align: { x: "left", y: "center" } },
            { text: "Transactions", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: fmtCurrency(totalDebit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(netBalance), align: { x: "left", y: "center" } },
            { text: entries.length.toString(), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();
        pdfGen.moveDown(0.5);

        // Ledger table — 7 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, 80, 110, "*", 110, 90, 90],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Type", align: { x: "left", y: "center" } },
            { text: "Description / Reference", align: { x: "left", y: "center" } },
            { text: "Reference", align: { x: "center", y: "center" } },
            { text: "Debit (IN)", align: { x: "right", y: "center" } },
            { text: "Credit (OUT)", align: { x: "right", y: "center" } },
        ]);
        entries.forEach((entry, i) => {
            table.row([
                { text: String(i + 1), align: { x: "center", y: "center" } },
                { text: fmtDate(entry.date, "DD-MM-YYYY hh:mm A"), align: { x: "center", y: "center" } },
                { text: entry.type, align: { x: "left", y: "center" } },
                { text: entry.description, align: { x: "left", y: "center" } },
                { text: entry.reference, align: { x: "center", y: "center" } },
                { text: entry.debit ? fmtCurrency(entry.debit) : "-", align: { x: "right", y: "center" } },
                { text: entry.credit ? fmtCurrency(entry.credit) : "-", align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Grand Total", colSpan: 5, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "right", y: "center" } },
        ]);
        table.end();

        pdfGen.moveDown(1);
        generateSignatureSection(doc, {
            signatures: [
                { label: "Prepared By", name: "_________________", title: "Accountant" },
                { label: "Reviewed By", name: "_________________", title: "Finance Manager" },
                { label: "Approved By", name: "_________________", title: "General Manager" },
            ],
            spacing: 30,
            lineWidth: 120,
            labelFont: { family: "Helvetica-Bold", size: 8 },
            nameFont: { size: 9 },
        });

        const safeName = account.name.replace(/[^a-zA-Z0-9_-]/g, "_");
        await pdfGen.sendToResponse(res, `account-statement-${safeName}-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Account statement PDF error:", error);
        res.status(500).json({ error: "Failed to generate account statement PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
