import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import { fmtDate, fmtCurrency, createReport, sendReport } from "./helpers";
import type { TableCell } from "../../utils/pdf/report-spec";

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
            transfersFrom,
            transfersTo,
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
            prisma.accountTransfer.findMany({
                where: { fromAccountId: accountId, ...tsRange("createdAt") },
                orderBy: { createdAt: "asc" },
                select: {
                    id: true, amount: true, note: true, createdAt: true,
                    toAccount: { select: { name: true, code: true } }
                },
            }),
            prisma.accountTransfer.findMany({
                where: { toAccountId: accountId, ...tsRange("createdAt") },
                orderBy: { createdAt: "asc" },
                select: {
                    id: true, amount: true, note: true, createdAt: true,
                    fromAccount: { select: { name: true, code: true } }
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
        for (const tf of transfersFrom) {
            entries.push({
                date: tf.createdAt,
                type: "Transfer Out",
                reference: `TRF-${tf.id}`,
                description: `Transfer to ${tf.toAccount.name} (${tf.toAccount.code})` + (tf.note ? ` — ${tf.note}` : ""),
                debit: 0,
                credit: tf.amount,
            });
        }
        for (const tt of transfersTo) {
            entries.push({
                date: tt.createdAt,
                type: "Transfer In",
                reference: `TRF-${tt.id}`,
                description: `Transfer from ${tt.fromAccount.name} (${tt.fromAccount.code})` + (tt.note ? ` — ${tt.note}` : ""),
                debit: tt.amount,
                credit: 0,
            });
        }
        // Sort chronologically
        entries.sort((a, b) => a.date.getTime() - b.date.getTime());

        const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
        const totalCredit = entries.reduce((s, e) => s + e.credit, 0);
        const netBalance = (account.openingBalance ?? 0) + totalDebit - totalCredit;

        const openingBalance = account.openingBalance ?? 0;
        const safeName = account.name.replace(/[^a-zA-Z0-9_-]/g, "_");

        const report = createReport({
            title: "Account Statement",
            subtitle: `${account.code} — ${account.name} (${account.type})`,
            filename: `account-statement-${safeName}-${dayjs().format("YYYY-MM-DD")}.pdf`,
            orientation: "landscape",
            filters: {
                Account: `${account.code} / ${account.name}`,
                Type: account.type,
                From: from ? fmtDate(from as string) : "All Time",
                To: to ? fmtDate(to as string) : "Now",
                Entries: entries.length,
            },
        });

        report.stats([
            { label: "Opening Balance", value: fmtCurrency(openingBalance), tone: "muted" },
            { label: "Total Debit (In)", value: fmtCurrency(totalDebit), tone: "success" },
            { label: "Total Credit (Out)", value: fmtCurrency(totalCredit), tone: "danger" },
            {
                label: "Closing Balance",
                value: fmtCurrency(netBalance),
                tone: netBalance < 0 ? "danger" : "primary",
                note: `${entries.length} transactions`,
            },
        ]);

        report.section("Ledger", `${entries.length} transaction(s), oldest first`);

        if (entries.length === 0) {
            report.note("No transactions were recorded on this account for the selected period.");
        } else {
            const rows: TableCell[][] = entries.map((entry, i) => [
                String(i + 1),
                fmtDate(entry.date, "DD-MM-YYYY hh:mm A"),
                entry.type,
                entry.description,
                entry.reference,
                entry.debit ? { text: fmtCurrency(entry.debit), align: "right" as const, tone: "success" as const } : "-",
                entry.credit ? { text: fmtCurrency(entry.credit), align: "right" as const, tone: "danger" as const } : "-",
            ]);

            report.table({
                columns: [
                    { label: "#", width: 26, align: "center" },
                    { label: "Date", width: 96, align: "center" },
                    { label: "Type", width: 110 },
                    { label: "Description", width: "*" },
                    { label: "Reference", width: 104, align: "center" },
                    { label: "Debit (In)", width: 86, align: "right" },
                    { label: "Credit (Out)", width: 86, align: "right" },
                ],
                rows,
                totalRow: [
                    { text: "Grand Total", colSpan: 5 },
                    fmtCurrency(totalDebit),
                    fmtCurrency(totalCredit),
                ],
            });
        }

        report.signatures([
            { label: "Prepared By", name: "_________________", title: "Accountant" },
            { label: "Reviewed By", name: "_________________", title: "Finance Manager" },
            { label: "Approved By", name: "_________________", title: "General Manager" },
        ]);

        await sendReport(res, report);
    } catch (error) {
        console.error("Account statement PDF error:", error);
        res.status(500).json({ error: "Failed to generate account statement PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
