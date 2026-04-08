import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

// ---- EXPENSES ----

export const listExpenses = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip, q } = getPaginationParams(req);
    const where: any = {};
    if (q) {
        where.OR = [
            { description: { contains: q, mode: "insensitive" } },
            { category: { contains: q, mode: "insensitive" } },
        ];
    }
    if (req.query.category) where.category = req.query.category;
    if (req.query.userId) where.userId = parseInt(req.query.userId as string);
    if (req.query.from || req.query.to) {
        where.date = {};
        if (req.query.from) where.date.gte = new Date(req.query.from as string);
        if (req.query.to) where.date.lte = new Date(req.query.to as string);
    }

    try {
        const [expenses, total] = await Promise.all([
            prisma.expense.findMany({
                where, skip, take: pageSize,
                orderBy: { date: "desc" },
                include: {
                    account: true,
                    user: { select: { id: true, name: true } },
                },
            }),
            prisma.expense.count({ where }),
        ]);
        res.json(createPaginatedResponse(expenses, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch expenses" });
    }
};

export const getExpense = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const expense = await prisma.expense.findUnique({
            where: { id },
            include: { account: true, user: { select: { id: true, name: true } } },
        });
        if (!expense) { res.status(404).json({ error: "Expense not found" }); return; }
        res.json(expense);
    } catch {
        res.status(500).json({ error: "Failed to fetch expense" });
    }
};

export const createExpense = async (req: Request, res: Response): Promise<void> => {
    const { description, amount, category, accountId, date } = req.body;
    const userId = req.user?.id;

    if (!description || !amount || !category || !accountId) {
        res.status(400).json({ error: "description, amount, category and accountId are required" });
        return;
    }
    try {
        const expense = await prisma.expense.create({
            data: {
                description, amount, category, accountId,
                userId,
                date: date ? new Date(date) : new Date(),
            },
            include: { account: true },
        });
        res.status(201).json(expense);
    } catch {
        res.status(500).json({ error: "Failed to create expense" });
    }
};

export const updateExpense = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { description, amount, category, accountId, date } = req.body;
    try {
        const expense = await prisma.expense.update({
            where: { id },
            data: {
                description, amount, category, accountId,
                date: date ? new Date(date) : undefined,
            },
            include: { account: true },
        });
        res.json(expense);
    } catch {
        res.status(500).json({ error: "Failed to update expense" });
    }
};

export const deleteExpense = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        await prisma.expense.delete({ where: { id } });
        res.json({ message: "Expense deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete expense" });
    }
};

// ---- RECURRING EXPENSES ----

export const listRecurringExpenses = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip, q } = getPaginationParams(req);
    const where: any = {};
    if (q) where.name = { contains: q, mode: "insensitive" };
    if (req.query.active !== undefined) where.active = req.query.active === "true";
    if (req.query.frequency) where.frequency = req.query.frequency;

    try {
        const [expenses, total] = await Promise.all([
            prisma.recurringExpense.findMany({
                where, skip, take: pageSize,
                orderBy: { name: "asc" },
                include: { account: true },
            }),
            prisma.recurringExpense.count({ where }),
        ]);
        res.json(createPaginatedResponse(expenses, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch recurring expenses" });
    }
};

export const getRecurringExpense = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const expense = await prisma.recurringExpense.findUnique({
            where: { id },
            include: { account: true },
        });
        if (!expense) { res.status(404).json({ error: "Recurring expense not found" }); return; }
        res.json(expense);
    } catch {
        res.status(500).json({ error: "Failed to fetch recurring expense" });
    }
};

export const createRecurringExpense = async (req: Request, res: Response): Promise<void> => {
    const { name, description, category, amount, frequency, startDate, endDate, active, accountId } = req.body;
    const VALID_FREQ = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"];
    if (!name || !category || !amount || !startDate) {
        res.status(400).json({ error: "name, category, amount and startDate are required" });
        return;
    }
    if (frequency && !VALID_FREQ.includes(frequency)) {
        res.status(400).json({ error: `frequency must be one of: ${VALID_FREQ.join(", ")}` });
        return;
    }
    try {
        const expense = await prisma.recurringExpense.create({
            data: {
                name, description, category, amount, frequency,
                startDate: new Date(startDate),
                endDate: endDate ? new Date(endDate) : undefined,
                active: active ?? true,
                accountId,
            },
        });
        res.status(201).json(expense);
    } catch {
        res.status(500).json({ error: "Failed to create recurring expense" });
    }
};

export const updateRecurringExpense = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { name, description, category, amount, frequency, startDate, endDate, active, accountId } = req.body;
    try {
        const expense = await prisma.recurringExpense.update({
            where: { id },
            data: {
                name, description, category, amount, frequency,
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                active, accountId,
            },
        });
        res.json(expense);
    } catch {
        res.status(500).json({ error: "Failed to update recurring expense" });
    }
};

export const deleteRecurringExpense = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        await prisma.recurringExpense.delete({ where: { id } });
        res.json({ message: "Recurring expense deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete recurring expense" });
    }
};
