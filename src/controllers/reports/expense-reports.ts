import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import {
    fmtDate,
    fmtCurrency,
    pdfConfig,
    generateQRBuffer,
    createPDFGenerator
} from "./helpers";

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

        const rows = expenses.map((e, i) => ({
            sno: i + 1,
            date: e.date,
            description: e.description,
            category: e.category,
            account: e.account.name,
            amount: e.amount,
        }));

        const expQr = await generateQRBuffer(`Expenses Report | ${from ? fmtDate(from as string) : "All"} - ${to ? fmtDate(to as string) : "Now"} | Records: ${expenses.length}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Expenses Report", "Expense Transactions", {
                "From": from ? fmtDate(from as string) : "All Time",
                "To": to ? fmtDate(to as string) : "Now",
                "Total Records": expenses.length,
            }, undefined, undefined, expQr)
        );
        const doc = pdfGen.getDocument();

        // Category breakdown summary
        const catEntries = [["Total Expenses", fmtCurrency(totalAmount)], ...Object.entries(byCategory).map(([c, v]) => [c, fmtCurrency(v)])];
        const catCols = Math.min(catEntries.length, 4);
        const catColStyles: ("*" | number)[] = Array(catCols).fill("*");
        doc.x = doc.page.margins.left;
        const catTable = doc.table({ columnStyles: catColStyles });
        for (let i = 0; i < catEntries.length; i += catCols) {
            const chunk = catEntries.slice(i, i + catCols);
            while (chunk.length < catCols) chunk.push(["", ""]);
            catTable.row(chunk.map(([label]) => ({ text: label, align: { x: "left" as const, y: "center" as const } })));
            catTable.row(chunk.map(([, value]) => ({ text: value, align: { x: "left" as const, y: "center" as const } })));
        }
        catTable.end();

        pdfGen.moveDown(0.5);

        // Expenses table — 6 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, 80, "*", 90, 90, 90],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Description", align: { x: "left", y: "center" } },
            { text: "Category", align: { x: "left", y: "center" } },
            { text: "Account", align: { x: "left", y: "center" } },
            { text: "Amount", align: { x: "right", y: "center" } },
        ]);
        rows.forEach((row) => {
            table.row([
                { text: String(row.sno), align: { x: "center", y: "center" } },
                { text: fmtDate(row.date, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: row.description, align: { x: "left", y: "center" } },
                { text: row.category, align: { x: "left", y: "center" } },
                { text: row.account, align: { x: "left", y: "center" } },
                { text: fmtCurrency(row.amount), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Grand Total", colSpan: 5, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalAmount), align: { x: "right", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `expenses-report-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Expenses report PDF error:", error);
        res.status(500).json({ error: "Failed to generate expenses report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
