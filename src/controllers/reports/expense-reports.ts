import { Request, Response } from "express";
import { prisma } from "../../prisma/prisma";
import { fmtDate, fmtCurrency, createReport, reportFilename, sendReport } from "./helpers";
import type { StatItem, TableCell } from "../../utils/pdf/report-spec";

export const getExpensesReportPDF = async (req: Request, res: Response): Promise<void> => {
    const { from, to } = req.query;
    const where: any = {};
    if (from) where.date = { ...where.date, gte: new Date(`${from}T00:00:00.000`) };
    if (to) where.date = { ...where.date, lte: new Date(`${to}T23:59:59.999`) };

    try {
        const expenses = await prisma.expense.findMany({
            where,
            orderBy: { date: "desc" },
            include: { account: { select: { name: true } } },
        });

        const totalAmount = expenses.reduce((s, e) => s + e.amount, 0);
        const byCategory: Record<string, number> = {};
        for (const e of expenses) {
            byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
        }
        const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

        const report = createReport({
            title: "Expenses Report",
            subtitle: "Expense transactions and category split",
            filename: reportFilename("expenses-report"),
            filters: {
                From: from ? fmtDate(from as string) : "All Time",
                To: to ? fmtDate(to as string) : "Now",
                Records: expenses.length,
            },
        });

        report.stats([
            { label: "Total Expenses", value: fmtCurrency(totalAmount), tone: "danger", note: `${expenses.length} entries` },
            { label: "Categories", value: String(categories.length) },
            {
                label: "Average / Entry",
                value: fmtCurrency(expenses.length ? Math.round(totalAmount / expenses.length) : 0),
                tone: "muted",
            },
            {
                label: "Largest Category",
                value: categories.length ? categories[0][0] : "—",
                note: categories.length ? fmtCurrency(categories[0][1]) : undefined,
                tone: "warning",
            },
        ]);

        if (categories.length) {
            report.section("Spend by Category", "Share of total expenditure");
            report.stats(
                categories.map<StatItem>(([name, amount]) => ({
                    label: name,
                    value: fmtCurrency(amount),
                    note: totalAmount ? `${((amount / totalAmount) * 100).toFixed(1)}% of total` : undefined,
                    tone: "warning",
                }))
            );
        }

        report.section("Expense Entries", `${expenses.length} record(s)`);

        if (expenses.length === 0) {
            report.note("No expenses were recorded for the selected period.");
        } else {
            const rows: TableCell[][] = expenses.map((e, i) => [
                String(i + 1),
                fmtDate(e.date, "DD-MM-YYYY"),
                e.description,
                e.category,
                e.account.name,
                fmtCurrency(e.amount),
            ]);

            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Date", width: 74, align: "center" },
                    { label: "Description", width: "*" },
                    { label: "Category", width: 92 },
                    { label: "Account", width: 92 },
                    { label: "Amount", width: 84, align: "right" },
                ],
                rows,
                totalRow: [{ text: "Grand Total", colSpan: 5 }, fmtCurrency(totalAmount)],
            });
        }

        await sendReport(res, report);
    } catch (error) {
        console.error("Expenses report PDF error:", error);
        res.status(500).json({ error: "Failed to generate expenses report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
