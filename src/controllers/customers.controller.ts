import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";
import { computeCustomerBalance, computeAllCustomerBalances, computeRunningBalances } from "../utils/balance";

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

        // Compute balances for all customers with ledger entries, then attach
        const balanceMap = await computeAllCustomerBalances();
        
        // Fetch opening balance entries
        const obEntries = await prisma.customerLedger.findMany({
            where: {
                customerId: { in: customers.map(c => c.id) },
                type: 'OPENING_BALANCE'
            }
        });
        const obMap = new Map<number, { amount: number; type: string }>();
        for (const entry of obEntries) {
            const type = entry.credit > 0 ? 'CREDIT' : 'DEBIT';
            obMap.set(entry.customerId, { amount: entry.amount, type });
        }

        const withBalances = customers.map((c) => {
            const ob = obMap.get(c.id);
            return {
                ...c,
                balance: balanceMap.get(c.id) ?? 0,
                openingBalance: ob ? ob.amount : 0,
                openingBalanceType: ob ? ob.type : 'DEBIT',
            };
        });

        res.json(createPaginatedResponse(withBalances, total, page, pageSize));
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

        const balance = await computeCustomerBalance(id);
        let running = balance;
        const ledgerWithBalances = customer.ledger.map((e, idx) => {
            if (idx > 0) {
                const prev = customer.ledger[idx - 1];
                running -= (prev.debit - prev.credit);
            }
            return { ...e, balance: running };
        });

        const obEntry = await prisma.customerLedger.findFirst({
            where: { customerId: id, type: 'OPENING_BALANCE' }
        });
        const openingBalance = obEntry ? obEntry.amount : 0;
        const openingBalanceType = obEntry && obEntry.credit > 0 ? 'CREDIT' : 'DEBIT';

        res.json({
            ...customer,
            ledger: ledgerWithBalances,
            balance,
            openingBalance,
            openingBalanceType
        });
    } catch {
        res.status(500).json({ error: "Failed to fetch customer" });
    }
};

export const createCustomer = async (req: Request, res: Response): Promise<void> => {
    const { name, phone, address, email, creditLimit, openingBalance, openingBalanceType } = req.body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    try {
        const obVal = typeof openingBalance === 'number' ? openingBalance : null;
        if (obVal !== null && obVal !== 0) {
            const customer = await prisma.$transaction(async (tx) => {
                const c = await tx.customer.create({
                    data: { name, phone, address, email, creditLimit },
                });

                let debit = 0;
                let credit = 0;
                if (openingBalanceType) {
                    const typeUpper = String(openingBalanceType).toUpperCase();
                    if (typeUpper === 'CREDIT') {
                        credit = Math.abs(obVal);
                    } else {
                        debit = Math.abs(obVal);
                    }
                } else {
                    debit = obVal > 0 ? obVal : 0;
                    credit = obVal < 0 ? Math.abs(obVal) : 0;
                }

                await tx.customerLedger.create({
                    data: {
                        customerId: c.id,
                        type: 'OPENING_BALANCE',
                        debit,
                        credit,
                        note: 'Opening balance',
                    },
                });
                return c;
            });
            const balance = await computeCustomerBalance(customer.id);
            res.status(201).json({ ...customer, balance });
        } else {
            const customer = await prisma.customer.create({
                data: { name, phone, address, email, creditLimit },
            });
            res.status(201).json({ ...customer, balance: 0 });
        }
    } catch {
        res.status(500).json({ error: "Failed to create customer" });
    }
};

export const updateCustomer = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { name, phone, address, email, creditLimit, active, openingBalance, openingBalanceType } = req.body;
    try {
        const customer = await prisma.$transaction(async (tx) => {
            const c = await tx.customer.update({
                where: { id },
                data: { name, phone, address, email, creditLimit, active },
            });

            if (openingBalance !== undefined) {
                const obVal = typeof openingBalance === 'number' ? openingBalance : 0;
                
                // Find existing OPENING_BALANCE ledger entry
                const existingOB = await tx.customerLedger.findFirst({
                    where: { customerId: id, type: 'OPENING_BALANCE' },
                });

                if (obVal === 0) {
                    // If opening balance is updated to 0, delete the ledger entry
                    if (existingOB) {
                        await tx.customerLedger.delete({
                            where: { id: existingOB.id },
                        });
                    }
                } else {
                    let debit = 0;
                    let credit = 0;
                    if (openingBalanceType) {
                        const typeUpper = String(openingBalanceType).toUpperCase();
                        if (typeUpper === 'CREDIT') {
                            credit = Math.abs(obVal);
                        } else {
                            debit = Math.abs(obVal);
                        }
                    } else {
                        debit = obVal > 0 ? obVal : 0;
                        credit = obVal < 0 ? Math.abs(obVal) : 0;
                    }

                    if (existingOB) {
                        await tx.customerLedger.update({
                            where: { id: existingOB.id },
                            data: { debit, credit, amount: Math.abs(obVal) },
                        });
                    } else {
                        await tx.customerLedger.create({
                            data: {
                                customerId: id,
                                type: 'OPENING_BALANCE',
                                debit,
                                credit,
                                note: 'Opening balance',
                            },
                        });
                    }
                }
            }
            return c;
        });

        const balance = await computeCustomerBalance(id);
        res.json({ ...customer, balance });
    } catch (err) {
        console.error("Error updating customer:", err);
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

        let running = 0;
        if (entries.length > 0) {
            const agg = await prisma.customerLedger.aggregate({
                where: {
                    customerId,
                    createdAt: { lte: entries[0].createdAt },
                },
                _sum: { debit: true, credit: true },
            });
            running = (agg._sum.debit ?? 0) - (agg._sum.credit ?? 0);
        }

        const withBalances = entries.map((e, idx) => {
            if (idx > 0) {
                const prev = entries[idx - 1];
                running -= (prev.debit - prev.credit);
            }
            return { ...e, balance: running };
        });

        res.json(createPaginatedResponse(withBalances, total, page, pageSize));
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

        const entry = await prisma.customerLedger.create({
            data: { customerId, type, amount: absAmount, debit: entryDebit, credit: entryCredit, note, reference, referenceId },
        });
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
    const { amount, accountId, note, date, type } = req.body;
    if (!amount || !accountId) {
        res.status(400).json({ error: "amount and accountId are required" });
        return;
    }
    try {
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

        const paymentDate = date ? new Date(date) : new Date();
        const pType = type === "SENT" ? "SENT" : "RECEIVED";

        let debit = 0;
        let credit = 0;
        if (pType === "SENT") {
            debit = Math.abs(amount);
        } else {
            credit = Math.abs(amount);
        }

        const [payment] = await prisma.$transaction([
            prisma.customerPayment.create({
                data: { customerId, amount: Math.abs(amount), type: pType, accountId, note, date: paymentDate },
                include: { account: true },
            }),
            prisma.customerLedger.create({
                data: {
                    customerId,
                    type: pType === "SENT" ? "REFUND" : "PAYMENT",
                    amount: Math.abs(amount),
                    debit,
                    credit,
                    note,
                    reference: `PMT-${Date.now()}`,
                },
            }),
        ]);
        res.status(201).json(payment);
    } catch (err) {
        console.error("Error creating customer payment:", err);
        res.status(500).json({ error: "Failed to create payment" });
    }
};
