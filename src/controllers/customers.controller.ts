import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

// ---- CUSTOMERS ----

export const listCustomers = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip, q } = getPaginationParams(req);
    const where: any = {};
    if (q) {
        where.OR = [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
        ];
    }
    if (req.query.active !== undefined) where.active = req.query.active === "true";

    try {
        const [customers, total] = await Promise.all([
            prisma.customer.findMany({ where, skip, take: pageSize, orderBy: { name: "asc" } }),
            prisma.customer.count({ where }),
        ]);
        res.json(createPaginatedResponse(customers, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch customers" });
    }
};

export const getCustomer = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const customer = await prisma.customer.findUnique({
            where: { id },
            include: {
                ledger: { orderBy: { createdAt: "desc" }, take: 20 },
                payments: { orderBy: { createdAt: "desc" }, take: 10 },
            },
        });
        if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
        res.json(customer);
    } catch {
        res.status(500).json({ error: "Failed to fetch customer" });
    }
};

export const createCustomer = async (req: Request, res: Response): Promise<void> => {
    const { name, phone, address, email, creditLimit, openingBalance } = req.body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    try {
        const ob = typeof openingBalance === 'number' && openingBalance !== 0 ? openingBalance : null;
        if (ob !== null) {
            const customer = await prisma.$transaction(async (tx) => {
                const c = await tx.customer.create({
                    data: { name, phone, address, email, creditLimit, balance: ob },
                });
                await tx.customerLedger.create({
                    data: {
                        customerId: c.id,
                        type: 'OPENING_BALANCE',
                        debit: ob > 0 ? ob : 0,
                        credit: ob < 0 ? Math.abs(ob) : 0,
                        balance: ob,
                        note: 'Opening balance',
                    },
                });
                return c;
            });
            res.status(201).json(customer);
        } else {
            const customer = await prisma.customer.create({
                data: { name, phone, address, email, creditLimit },
            });
            res.status(201).json(customer);
        }
    } catch {
        res.status(500).json({ error: "Failed to create customer" });
    }
};

export const updateCustomer = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { name, phone, address, email, creditLimit, active } = req.body;
    try {
        const customer = await prisma.customer.update({
            where: { id },
            data: { name, phone, address, email, creditLimit, active },
        });
        res.json(customer);
    } catch {
        res.status(500).json({ error: "Failed to update customer" });
    }
};

export const deleteCustomer = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        await prisma.customer.delete({ where: { id } });
        res.json({ message: "Customer deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete customer — it may be in use" });
    }
};

// ---- CUSTOMER LEDGER ----

export const listCustomerLedger = async (req: Request, res: Response): Promise<void> => {
    const customerId = parseInt(req.params.id);
    const { page, pageSize, skip } = getPaginationParams(req);
    try {
        const [entries, total] = await Promise.all([
            prisma.customerLedger.findMany({
                where: { customerId },
                skip, take: pageSize,
                orderBy: { createdAt: "desc" },
            }),
            prisma.customerLedger.count({ where: { customerId } }),
        ]);
        res.json(createPaginatedResponse(entries, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch customer ledger" });
    }
};

export const createCustomerLedgerEntry = async (req: Request, res: Response): Promise<void> => {
    const customerId = parseInt(req.params.id);
    const { type, amount, debit, credit, note, reference, referenceId } = req.body;
    const VALID_TYPES = ["SALE", "PAYMENT", "SALE_RETURN", "REFUND", "ADJUSTMENT_DR", "ADJUSTMENT_CR", "OPENING_BALANCE"];
    if (!type || (!amount && !debit && !credit)) { res.status(400).json({ error: "type and amount (or debit/credit) are required" }); return; }
    if (!VALID_TYPES.includes(type)) {
        res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` });
        return;
    }
    try {
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

        const CREDIT_TYPES = ["PAYMENT", "SALE_RETURN", "REFUND", "ADJUSTMENT_CR"];
        const isCredit = CREDIT_TYPES.includes(type);
        const absAmount = Math.abs(amount || debit || credit || 0);
        const entryDebit = debit ? Math.abs(debit) : (isCredit ? 0 : absAmount);
        const entryCredit = credit ? Math.abs(credit) : (isCredit ? absAmount : 0);
        const delta = entryDebit - entryCredit;
        const newBalance = customer.balance + delta;

        const [entry] = await prisma.$transaction([
            prisma.customerLedger.create({
                data: { customerId, type, amount: absAmount, debit: entryDebit, credit: entryCredit, balance: newBalance, note, reference, referenceId },
            }),
            prisma.customer.update({ where: { id: customerId }, data: { balance: newBalance } }),
        ]);
        res.status(201).json(entry);
    } catch {
        res.status(500).json({ error: "Failed to create ledger entry" });
    }
};

// ---- CUSTOMER PAYMENTS ----

export const listCustomerPayments = async (req: Request, res: Response): Promise<void> => {
    const customerId = parseInt(req.params.id);
    const { page, pageSize, skip } = getPaginationParams(req);
    try {
        const [payments, total] = await Promise.all([
            prisma.customerPayment.findMany({
                where: { customerId },
                skip, take: pageSize,
                orderBy: { createdAt: "desc" },
                include: { account: true },
            }),
            prisma.customerPayment.count({ where: { customerId } }),
        ]);
        res.json(createPaginatedResponse(payments, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch payments" });
    }
};

export const createCustomerPayment = async (req: Request, res: Response): Promise<void> => {
    const customerId = parseInt(req.params.id);
    const { amount, accountId, note, date } = req.body;
    if (!amount || !accountId) {
        res.status(400).json({ error: "amount and accountId are required" });
        return;
    }
    try {
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

        const newBalance = customer.balance - Math.abs(amount);
        const paymentDate = date ? new Date(date) : new Date();

        const [payment] = await prisma.$transaction([
            prisma.customerPayment.create({
                data: { customerId, amount: Math.abs(amount), accountId, note, date: paymentDate },
                include: { account: true },
            }),
            prisma.customerLedger.create({
                data: {
                    customerId, type: "PAYMENT",
                    amount: Math.abs(amount), debit: 0, credit: Math.abs(amount), balance: newBalance,
                    note, reference: `PMT-${Date.now()}`,
                },
            }),
            prisma.customer.update({ where: { id: customerId }, data: { balance: newBalance } }),
        ]);
        res.status(201).json(payment);
    } catch {
        res.status(500).json({ error: "Failed to create payment" });
    }
};
