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
import type { ReportBuilder } from "./helpers";
import type { StatItem, TableCell } from "../../utils/pdf/report-spec";
import type { Tone } from "../../utils/pdf/report-theme";
import {
    computeAllCustomerBalances,
    computeAllSupplierBalances,
} from "../../utils/balance";

/* ------------------------------------------------------------------ */
/* Shared ledger rendering                                             */
/* ------------------------------------------------------------------ */

interface LedgerRow {
    createdAt: Date;
    type: string;
    reference: string | null;
    note: string | null;
    debit: number;
    credit: number;
    balance: number;
}

/**
 * The four statement/ledger reports differ only in their labels and in which
 * ledger table they read. Their layout is identical, so it lives here once.
 */
function appendLedger(
    report: ReportBuilder,
    rows: LedgerRow[],
    totals: { openingBalance: number; totalDebit: number; totalCredit: number; closingBalance: number },
    options: { showOpeningRow: boolean; openingDate?: string; debitLabel: string; creditLabel: string }
): void {
    report.section("Ledger", `${rows.length} entry(ies), oldest first`);

    if (rows.length === 0 && !options.showOpeningRow) {
        report.note("No ledger entries were recorded for the selected period.");
        return;
    }

    const tableRows: TableCell[][] = [];

    if (options.showOpeningRow) {
        tableRows.push([
            options.openingDate ?? "",
            "OPENING BAL",
            { text: "Opening Balance", bold: true },
            "-",
            "-",
            { text: fmtCurrency(totals.openingBalance), align: "right", bold: true },
        ]);
    }

    for (const row of rows) {
        tableRows.push([
            fmtDate(row.createdAt, "DD-MM-YYYY"),
            row.type.replace(/_/g, " "),
            row.reference ?? row.note ?? "-",
            row.debit ? { text: fmtCurrency(row.debit), align: "right", tone: "danger" } : "-",
            row.credit ? { text: fmtCurrency(row.credit), align: "right", tone: "success" } : "-",
            { text: fmtCurrency(row.balance), align: "right" },
        ]);
    }

    report.table({
        columns: [
            { label: "Date", width: 78, align: "center" },
            { label: "Type", width: 96, align: "center" },
            { label: "Reference / Note", width: "*" },
            { label: options.debitLabel, width: 82, align: "right" },
            { label: options.creditLabel, width: 82, align: "right" },
            { label: "Balance", width: 88, align: "right" },
        ],
        rows: tableRows,
        totalRow: [
            { text: "Total", colSpan: 3 },
            fmtCurrency(totals.totalDebit),
            fmtCurrency(totals.totalCredit),
            fmtCurrency(totals.closingBalance),
        ],
    });
}

function balanceTone(balance: number): Tone {
    if (balance > 0) return "danger";
    if (balance < 0) return "warning";
    return "muted";
}

/* ------------------------------------------------------------------ */
/* Balance summaries                                                   */
/* ------------------------------------------------------------------ */

export const getCustomerBalancesReportPDF = async (_req: Request, res: Response): Promise<void> => {
    try {
        const activeCustomers = await prisma.customer.findMany({ where: { active: true } });

        const balanceMap = await computeAllCustomerBalances();
        const customers = activeCustomers
            .map((c) => ({ ...c, balance: balanceMap.get(c.id) ?? 0 }))
            .filter((c) => c.balance !== 0)
            .sort((a, b) => b.balance - a.balance);

        const totalReceivable = customers.filter((c) => c.balance > 0).reduce((s, c) => s + c.balance, 0);
        const totalOverpaid = customers.filter((c) => c.balance < 0).reduce((s, c) => s + Math.abs(c.balance), 0);

        const report = createReport({
            title: "Customer Balances",
            subtitle: "Accounts receivable",
            filename: reportFilename("customer-balances"),
            filters: {
                Customers: customers.length,
                "As of": fmtDate(new Date()),
            },
        });

        report.stats([
            { label: "Customers with Balance", value: String(customers.length), tone: "primary" },
            { label: "Total Receivable", value: fmtCurrency(totalReceivable), tone: "danger", note: "owed to you" },
            { label: "Total Overpaid", value: fmtCurrency(totalOverpaid), tone: "warning", note: "advance held" },
            { label: "Net Position", value: fmtCurrency(totalReceivable - totalOverpaid), tone: "primary" },
        ]);

        report.section("Customer Balances", `${customers.length} record(s)`);

        if (customers.length === 0) {
            report.note("Every active customer is fully settled.");
        } else {
            const rowTones: (Tone | undefined)[] = [];
            const rows: TableCell[][] = customers.map((c, i) => {
                rowTones.push(undefined);
                return [
                    String(i + 1),
                    c.name,
                    c.phone ?? "N/A",
                    c.address ?? "N/A",
                    (c.creditLimit ?? 0) > 0 ? fmtCurrency(c.creditLimit) : "No Limit",
                    { text: fmtCurrency(c.balance), align: "right" as const, tone: balanceTone(c.balance) },
                    {
                        text: c.balance > 0 ? "RECEIVABLE" : "OVERPAID",
                        align: "center" as const,
                        tone: c.balance > 0 ? ("danger" as const) : ("warning" as const),
                    },
                ];
            });

            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Customer", width: "*" },
                    { label: "Phone", width: 84, align: "center" },
                    { label: "Address", width: 116 },
                    { label: "Credit Limit", width: 76, align: "right" },
                    { label: "Balance", width: 82, align: "right" },
                    { label: "Status", width: 76, align: "center" },
                ],
                rows,
                rowTones,
                totalRow: [
                    { text: "Net Total", colSpan: 5 },
                    fmtCurrency(totalReceivable - totalOverpaid),
                    "",
                ],
            });
        }

        await sendReport(res, report);
    } catch (error) {
        console.error("Customer balances PDF error:", error);
        res.status(500).json({ error: "Failed to generate customer balances report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

export const getSupplierBalancesReportPDF = async (_req: Request, res: Response): Promise<void> => {
    try {
        const activeSuppliers = await prisma.supplier.findMany({ where: { active: true } });

        const balanceMap = await computeAllSupplierBalances();
        const suppliers = activeSuppliers
            .map((s) => ({ ...s, balance: balanceMap.get(s.id) ?? 0 }))
            .filter((s) => s.balance !== 0)
            .sort((a, b) => b.balance - a.balance);

        const totalPayable = suppliers.filter((s) => s.balance > 0).reduce((s, sup) => s + sup.balance, 0);
        const totalOverpaid = suppliers.filter((s) => s.balance < 0).reduce((s, sup) => s + Math.abs(sup.balance), 0);

        const report = createReport({
            title: "Supplier Balances",
            subtitle: "Accounts payable",
            filename: reportFilename("supplier-balances"),
            filters: {
                Suppliers: suppliers.length,
                "As of": fmtDate(new Date()),
            },
        });

        report.stats([
            { label: "Suppliers with Balance", value: String(suppliers.length), tone: "primary" },
            { label: "Total Payable", value: fmtCurrency(totalPayable), tone: "danger", note: "you owe" },
            { label: "Total Overpaid", value: fmtCurrency(totalOverpaid), tone: "warning", note: "advance paid" },
            { label: "Net Position", value: fmtCurrency(totalPayable - totalOverpaid), tone: "primary" },
        ]);

        report.section("Supplier Balances", `${suppliers.length} record(s)`);

        if (suppliers.length === 0) {
            report.note("Every active supplier is fully settled.");
        } else {
            const rows: TableCell[][] = suppliers.map((s, i) => [
                String(i + 1),
                s.name,
                s.phone ?? "N/A",
                { text: fmtCurrency(s.balance), align: "right" as const, tone: balanceTone(s.balance) },
                {
                    text: s.balance > 0 ? "PAYABLE" : "OVERPAID",
                    align: "center" as const,
                    tone: s.balance > 0 ? ("danger" as const) : ("warning" as const),
                },
            ]);

            report.table({
                columns: [
                    { label: "#", width: 32, align: "center" },
                    { label: "Supplier", width: "*" },
                    { label: "Phone", width: 120, align: "center" },
                    { label: "Balance", width: 110, align: "right" },
                    { label: "Status", width: 90, align: "center" },
                ],
                rows,
                totalRow: [
                    { text: "Net Total", colSpan: 3 },
                    fmtCurrency(totalPayable - totalOverpaid),
                    "",
                ],
            });
        }

        await sendReport(res, report);
    } catch (error) {
        console.error("Supplier balances PDF error:", error);
        res.status(500).json({ error: "Failed to generate supplier balances report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

/* ------------------------------------------------------------------ */
/* Statements                                                          */
/* ------------------------------------------------------------------ */

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
                where: { customerId, createdAt: { lt: new Date(`${from}T00:00:00.000`) } },
                _sum: { debit: true, credit: true },
            });
            openingBalance = (aggBefore._sum.debit ?? 0) - (aggBefore._sum.credit ?? 0);
        }

        // Determine debit/credit direction by type.
        const debitTypes = ["SALE", "ADJUSTMENT_DR"];
        let runningBalance = openingBalance;
        const ledgerRows: LedgerRow[] = ledgerEntries.map((entry) => {
            const isDebit = debitTypes.includes(entry.type);
            const debit = isDebit ? entry.amount : 0;
            const credit = !isDebit ? entry.amount : 0;
            runningBalance += debit - credit;
            return {
                createdAt: entry.createdAt,
                type: entry.type,
                reference: entry.reference,
                note: entry.note,
                debit,
                credit,
                balance: runningBalance,
            };
        });

        const totalDebit = ledgerRows.reduce((s, r) => s + r.debit, 0);
        const totalCredit = ledgerRows.reduce((s, r) => s + r.credit, 0);
        const closingBalance = runningBalance;

        const salesCount = ledgerEntries.filter((e) => e.type === "SALE").length;
        const paymentsCount = ledgerEntries.filter((e) => e.type === "PAYMENT").length;

        const report = createReport({
            title: "Customer Statement",
            subtitle: customer.name,
            filename: `customer-statement-${customer.name}-${dayjs().format("YYYY-MM-DD")}.pdf`,
            filters: {
                Customer: customer.name,
                Phone: customer.phone ?? "N/A",
                From: from ? fmtDate(from as string) : "All Time",
                To: to ? fmtDate(to as string) : "Now",
            },
        });

        report.stats([
            { label: "Opening Balance", value: fmtCurrency(openingBalance), tone: "muted" },
            { label: "Total Invoiced", value: fmtCurrency(totalDebit), tone: "primary", note: `${salesCount} sales` },
            { label: "Total Paid", value: fmtCurrency(totalCredit), tone: "success", note: `${paymentsCount} payments` },
            {
                label: "Closing Balance",
                value: fmtCurrency(closingBalance),
                tone: balanceTone(closingBalance),
                note: closingBalance > 0 ? "receivable" : undefined,
            },
            {
                label: "Credit Limit",
                value: customer.creditLimit != null ? fmtCurrency(customer.creditLimit) : "No Limit",
                tone: "muted",
            },
        ]);

        appendLedger(
            report,
            ledgerRows,
            { openingBalance, totalDebit, totalCredit, closingBalance },
            {
                showOpeningRow: Boolean(from),
                openingDate: from ? fmtDate(from as string, "DD-MM-YYYY") : undefined,
                debitLabel: "Invoiced",
                creditLabel: "Paid",
            }
        );

        report.signatures([
            { label: "Customer Signature", name: "_________________", title: customer.name },
            { label: "Accountant", name: "_________________", title: "Accounts Dept." },
            { label: "Manager", name: "_________________", title: "General Manager" },
        ]);

        await sendReport(res, report);
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
                where: { supplierId, createdAt: { lt: new Date(`${from}T00:00:00.000`) } },
                _sum: { debit: true, credit: true },
            });
            openingBalance = (aggBefore._sum.debit ?? 0) - (aggBefore._sum.credit ?? 0);
        }

        // Debit types increase what we owe; credit types decrease it.
        const debitTypes = ["PURCHASE", "ADJUSTMENT_DR"];
        let runningBalance = openingBalance;
        const ledgerRows: LedgerRow[] = ledgerEntries.map((entry) => {
            const isDebit = debitTypes.includes(entry.type);
            const debit = isDebit ? entry.amount : 0;
            const credit = !isDebit ? entry.amount : 0;
            runningBalance += debit - credit;
            return {
                createdAt: entry.createdAt,
                type: entry.type,
                reference: entry.reference,
                note: entry.note,
                debit,
                credit,
                balance: runningBalance,
            };
        });

        const totalDebit = ledgerRows.reduce((s, r) => s + r.debit, 0);
        const totalCredit = ledgerRows.reduce((s, r) => s + r.credit, 0);
        const closingBalance = runningBalance;

        const purchasesCount = ledgerEntries.filter((e) => e.type === "PURCHASE").length;
        const paymentsCount = ledgerEntries.filter((e) => e.type === "PAYMENT").length;

        const report = createReport({
            title: "Supplier Statement",
            subtitle: supplier.name,
            filename: `supplier-statement-${supplier.name}-${dayjs().format("YYYY-MM-DD")}.pdf`,
            filters: {
                Supplier: supplier.name,
                Phone: supplier.phone ?? "N/A",
                Terms: supplier.paymentTerms ?? "N/A",
                From: from ? fmtDate(from as string) : "All Time",
                To: to ? fmtDate(to as string) : "Now",
            },
        });

        report.stats([
            { label: "Opening Balance", value: fmtCurrency(openingBalance), tone: "muted" },
            { label: "Total Purchases", value: fmtCurrency(totalDebit), tone: "primary", note: `${purchasesCount} purchases` },
            { label: "Total Paid", value: fmtCurrency(totalCredit), tone: "success", note: `${paymentsCount} payments` },
            {
                label: "Closing Balance",
                value: fmtCurrency(closingBalance),
                tone: balanceTone(closingBalance),
                note: closingBalance > 0 ? "payable" : undefined,
            },
            { label: "Tax ID", value: supplier.taxId ?? "N/A", tone: "muted" },
        ]);

        appendLedger(
            report,
            ledgerRows,
            { openingBalance, totalDebit, totalCredit, closingBalance },
            {
                showOpeningRow: Boolean(from),
                openingDate: from ? fmtDate(from as string, "DD-MM-YYYY") : undefined,
                debitLabel: "Purchased",
                creditLabel: "Paid",
            }
        );

        report.signatures([
            { label: "Supplier Signature", name: "_________________", title: supplier.name },
            { label: "Accountant", name: "_________________", title: "Accounts Dept." },
            { label: "Manager", name: "_________________", title: "General Manager" },
        ]);

        await sendReport(res, report);
    } catch (error) {
        console.error("Supplier statement PDF error:", error);
        res.status(500).json({ error: "Failed to generate supplier statement PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

/* ------------------------------------------------------------------ */
/* Ledgers                                                             */
/* ------------------------------------------------------------------ */

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

        // Opening balance: everything that happened before the range started.
        let openingBalance = 0;
        if (from) {
            const aggBefore = await prisma.customerLedger.aggregate({
                where: { customerId, createdAt: { lt: new Date(`${from}T00:00:00.000`) } },
                _sum: { debit: true, credit: true },
            });
            openingBalance = (aggBefore._sum.debit ?? 0) - (aggBefore._sum.credit ?? 0);
        }

        const debitTypes = ["SALE", "ADJUSTMENT_DR"];
        let totalDebit = 0;
        let totalCredit = 0;
        let runningBalance = openingBalance;
        const ledgerRows: LedgerRow[] = entries.map((entry) => {
            const debit = entry.debit || (debitTypes.includes(entry.type) ? entry.amount : 0);
            const credit = entry.credit || (!debitTypes.includes(entry.type) ? entry.amount : 0);
            totalDebit += debit;
            totalCredit += credit;
            runningBalance += debit - credit;
            return {
                createdAt: entry.createdAt,
                type: entry.type,
                reference: entry.reference,
                note: entry.note,
                debit,
                credit,
                balance: runningBalance,
            };
        });
        const closingBalance = runningBalance;

        const report = createReport({
            title: "Customer Ledger",
            subtitle: customer.name,
            filename: `customer-ledger-${customer.name}-${dayjs().format("YYYY-MM-DD")}.pdf`,
            filters: {
                Customer: customer.name,
                Phone: customer.phone ?? "N/A",
                From: from ? fmtDate(from as string) : "All Time",
                To: to ? fmtDate(to as string) : "Now",
            },
        });

        report.stats([
            { label: "Opening Balance", value: fmtCurrency(openingBalance), tone: "muted" },
            { label: "Total Debit", value: fmtCurrency(totalDebit), tone: "danger" },
            { label: "Total Credit", value: fmtCurrency(totalCredit), tone: "success" },
            { label: "Closing Balance", value: fmtCurrency(closingBalance), tone: balanceTone(closingBalance) },
            {
                label: "Credit Limit",
                value: customer.creditLimit != null ? fmtCurrency(customer.creditLimit) : "No Limit",
                tone: "muted",
            },
        ]);

        appendLedger(
            report,
            ledgerRows,
            { openingBalance, totalDebit, totalCredit, closingBalance },
            {
                showOpeningRow: Boolean(from),
                openingDate: from ? fmtDate(from as string, "DD-MM-YYYY") : undefined,
                debitLabel: "Debit",
                creditLabel: "Credit",
            }
        );

        await sendReport(res, report);
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

        // Opening balance: everything that happened before the range started.
        let openingBalance = 0;
        if (from) {
            const aggBefore = await prisma.supplierLedger.aggregate({
                where: { supplierId, createdAt: { lt: new Date(`${from}T00:00:00.000`) } },
                _sum: { debit: true, credit: true },
            });
            openingBalance = (aggBefore._sum.debit ?? 0) - (aggBefore._sum.credit ?? 0);
        }

        const debitTypes = ["PURCHASE", "ADJUSTMENT_DR"];
        let totalDebit = 0;
        let totalCredit = 0;
        let runningBalance = openingBalance;
        const ledgerRows: LedgerRow[] = entries.map((entry) => {
            const debit = entry.debit || (debitTypes.includes(entry.type) ? entry.amount : 0);
            const credit = entry.credit || (!debitTypes.includes(entry.type) ? entry.amount : 0);
            totalDebit += debit;
            totalCredit += credit;
            runningBalance += debit - credit;
            return {
                createdAt: entry.createdAt,
                type: entry.type,
                reference: entry.reference,
                note: entry.note,
                debit,
                credit,
                balance: runningBalance,
            };
        });
        const closingBalance = runningBalance;

        const report = createReport({
            title: "Supplier Ledger",
            subtitle: supplier.name,
            filename: `supplier-ledger-${supplier.name}-${dayjs().format("YYYY-MM-DD")}.pdf`,
            filters: {
                Supplier: supplier.name,
                Phone: supplier.phone ?? "N/A",
                Terms: supplier.paymentTerms ?? "N/A",
                From: from ? fmtDate(from as string) : "All Time",
                To: to ? fmtDate(to as string) : "Now",
            },
        });

        report.stats([
            { label: "Opening Balance", value: fmtCurrency(openingBalance), tone: "muted" },
            { label: "Total Debit", value: fmtCurrency(totalDebit), tone: "danger" },
            { label: "Total Credit", value: fmtCurrency(totalCredit), tone: "success" },
            { label: "Closing Balance", value: fmtCurrency(closingBalance), tone: balanceTone(closingBalance) },
            { label: "Tax ID", value: supplier.taxId ?? "N/A", tone: "muted" },
        ]);

        appendLedger(
            report,
            ledgerRows,
            { openingBalance, totalDebit, totalCredit, closingBalance },
            {
                showOpeningRow: Boolean(from) && openingBalance !== 0,
                openingDate: from ? fmtDate(from as string, "DD-MM-YYYY") : undefined,
                debitLabel: "Debit",
                creditLabel: "Credit",
            }
        );

        await sendReport(res, report);
    } catch (error) {
        console.error("Supplier ledger report PDF error:", error);
        res.status(500).json({ error: "Failed to generate supplier ledger report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
