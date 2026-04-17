import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

const VALID_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];

async function computeBalancesForIds(accountIds: number[]): Promise<Map<number, number>> {
    if (accountIds.length === 0) return new Map();

    const [sp, cp, pp, ex, sup, sal, ea, trFrom, trTo] = await Promise.all([
        prisma.salePayment.groupBy({ by: ["accountId"], where: { accountId: { in: accountIds } }, _sum: { amount: true } }),
        prisma.customerPayment.groupBy({ by: ["accountId"], where: { accountId: { in: accountIds } }, _sum: { amount: true } }),
        prisma.purchasePayment.groupBy({ by: ["accountId"], where: { accountId: { in: accountIds } }, _sum: { amount: true } }),
        prisma.expense.groupBy({ by: ["accountId"], where: { accountId: { in: accountIds } }, _sum: { amount: true } }),
        prisma.supplierPayment.groupBy({ by: ["accountId"], where: { accountId: { in: accountIds } }, _sum: { amount: true } }),
        prisma.salarySlip.groupBy({ by: ["accountId"], where: { accountId: { in: accountIds }, status: "PAID" }, _sum: { netPayable: true } }),
        prisma.employeeAdvance.groupBy({ by: ["accountId"], where: { accountId: { in: accountIds } }, _sum: { amount: true } }),
        prisma.accountTransfer.groupBy({ by: ["fromAccountId"], where: { fromAccountId: { in: accountIds } }, _sum: { amount: true } }),
        prisma.accountTransfer.groupBy({ by: ["toAccountId"], where: { toAccountId: { in: accountIds } }, _sum: { amount: true } }),
    ]);

    const balances = new Map<number, number>(accountIds.map(id => [id, 0]));

    for (const row of sp) balances.set(row.accountId, (balances.get(row.accountId) ?? 0) + (row._sum.amount ?? 0));
    for (const row of cp) balances.set(row.accountId, (balances.get(row.accountId) ?? 0) + (row._sum.amount ?? 0));
    for (const row of pp) balances.set(row.accountId, (balances.get(row.accountId) ?? 0) - (row._sum.amount ?? 0));
    for (const row of ex) balances.set(row.accountId, (balances.get(row.accountId) ?? 0) - (row._sum.amount ?? 0));
    for (const row of sup) balances.set(row.accountId, (balances.get(row.accountId) ?? 0) - (row._sum.amount ?? 0));
    for (const row of sal) if (row.accountId != null) balances.set(row.accountId, (balances.get(row.accountId) ?? 0) - (row._sum.netPayable ?? 0));
    for (const row of ea) balances.set(row.accountId, (balances.get(row.accountId) ?? 0) - (row._sum.amount ?? 0));
    // Account transfers: subtract from source, add to destination
    for (const row of trFrom) balances.set(row.fromAccountId, (balances.get(row.fromAccountId) ?? 0) - (row._sum.amount ?? 0));
    for (const row of trTo) balances.set(row.toAccountId, (balances.get(row.toAccountId) ?? 0) + (row._sum.amount ?? 0));

    return balances;
}

export const listAccounts = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip, q } = getPaginationParams(req);
    const where: any = {};
    if (q) {
        where.OR = [
            { name: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
        ];
    }
    if (req.query.type) where.type = req.query.type;
    if (req.query.active !== undefined) where.active = req.query.active === "true";

    try {
        const [accounts, total] = await Promise.all([
            prisma.account.findMany({ where, skip, take: pageSize, orderBy: { code: "asc" } }),
            prisma.account.count({ where }),
        ]);
        const balances = await computeBalancesForIds(accounts.map(a => a.id));
        const accountsWithBalance = accounts.map(a => ({ ...a, balance: balances.get(a.id) ?? 0 }));
        res.json(createPaginatedResponse(accountsWithBalance, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch accounts" });
    }
};

export const getAccount = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const account = await prisma.account.findUnique({ where: { id } });
        if (!account) { res.status(404).json({ error: "Account not found" }); return; }
        const balances = await computeBalancesForIds([id]);
        res.json({ ...account, balance: balances.get(id) ?? 0 });
    } catch {
        res.status(500).json({ error: "Failed to fetch account" });
    }
};

export const createAccount = async (req: Request, res: Response): Promise<void> => {
    const { code, name, type, active } = req.body;
    if (!code || !name || !type) {
        res.status(400).json({ error: "code, name and type are required" });
        return;
    }
    if (!VALID_TYPES.includes(type)) {
        res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` });
        return;
    }
    try {
        const existing = await prisma.account.findUnique({ where: { code } });
        if (existing) { res.status(409).json({ error: "Account code already exists" }); return; }
        const account = await prisma.account.create({ data: { code, name, type, active } });
        res.status(201).json(account);
    } catch {
        res.status(500).json({ error: "Failed to create account" });
    }
};

export const updateAccount = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { code, name, type, active } = req.body;
    if (type && !VALID_TYPES.includes(type)) {
        res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` });
        return;
    }
    try {
        if (code) {
            const existing = await prisma.account.findFirst({ where: { code, NOT: { id } } });
            if (existing) { res.status(409).json({ error: "Account code already in use" }); return; }
        }
        const account = await prisma.account.update({ where: { id }, data: { code, name, type, active } });
        res.json(account);
    } catch {
        res.status(500).json({ error: "Failed to update account" });
    }
};

export const deleteAccount = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        await prisma.account.delete({ where: { id } });
        res.json({ message: "Account deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete account — it may be in use" });
    }
};

// ---- ACCOUNT TRANSFERS ----

export const transferBetweenAccounts = async (req: Request, res: Response): Promise<void> => {
    const { fromAccountId, toAccountId, amount, note } = req.body;
    if (!fromAccountId || !toAccountId || !amount) {
        res.status(400).json({ error: "fromAccountId, toAccountId and amount are required" });
        return;
    }
    if (fromAccountId === toAccountId) {
        res.status(400).json({ error: "Source and destination accounts must be different" });
        return;
    }
    if (amount <= 0) {
        res.status(400).json({ error: "Amount must be positive" });
        return;
    }
    try {
        const [from, to] = await Promise.all([
            prisma.account.findUnique({ where: { id: fromAccountId } }),
            prisma.account.findUnique({ where: { id: toAccountId } }),
        ]);
        if (!from) { res.status(404).json({ error: "Source account not found" }); return; }
        if (!to) { res.status(404).json({ error: "Destination account not found" }); return; }

        const transfer = await prisma.accountTransfer.create({
            data: { fromAccountId, toAccountId, amount, note },
            include: {
                fromAccount: { select: { id: true, name: true, code: true } },
                toAccount: { select: { id: true, name: true, code: true } },
            },
        });
        res.status(201).json(transfer);
    } catch {
        res.status(500).json({ error: "Failed to create transfer" });
    }
};

export const listTransfers = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip } = getPaginationParams(req);
    const where: any = {};
    if (req.query.accountId) {
        const accountId = parseInt(req.query.accountId as string);
        where.OR = [{ fromAccountId: accountId }, { toAccountId: accountId }];
    }
    try {
        const [transfers, total] = await Promise.all([
            prisma.accountTransfer.findMany({
                where, skip, take: pageSize,
                orderBy: { createdAt: "desc" },
                include: {
                    fromAccount: { select: { id: true, name: true, code: true } },
                    toAccount: { select: { id: true, name: true, code: true } },
                },
            }),
            prisma.accountTransfer.count({ where }),
        ]);
        res.json(createPaginatedResponse(transfers, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch transfers" });
    }
};
