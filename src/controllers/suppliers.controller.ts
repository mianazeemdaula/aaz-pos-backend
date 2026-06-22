import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";
import { computeSupplierBalance, computeAllSupplierBalances } from "../utils/balance";

// ---- SUPPLIERS ----

export const listSuppliers = async (req: Request, res: Response): Promise<void> => {
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
        const [suppliers, total] = await Promise.all([
            prisma.supplier.findMany({ where, skip, take: pageSize, orderBy: { name: "asc" } }),
            prisma.supplier.count({ where }),
        ]);

        // Compute balances for all suppliers with ledger entries, then attach
        const balanceMap = await computeAllSupplierBalances();

        // Fetch opening balance entries
        const obEntries = await prisma.supplierLedger.findMany({
            where: {
                supplierId: { in: suppliers.map(s => s.id) },
                type: 'OPENING_BALANCE'
            }
        });
        const obMap = new Map<number, { amount: number; type: string }>();
        for (const entry of obEntries) {
            const type = entry.debit > 0 ? 'CREDIT' : 'DEBIT';
            obMap.set(entry.supplierId, { amount: entry.amount, type });
        }

        const withBalances = suppliers.map((s) => {
            const ob = obMap.get(s.id);
            return {
                ...s,
                balance: balanceMap.get(s.id) ?? 0,
                openingBalance: ob ? ob.amount : 0,
                openingBalanceType: ob ? ob.type : 'CREDIT',
            };
        });

        res.json(createPaginatedResponse(withBalances, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch suppliers" });
    }
};

export const getSupplier = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const supplier = await prisma.supplier.findUnique({
            where: { id },
            include: {
                ledger: { orderBy: { createdAt: "desc" }, take: 20 },
                payments: { orderBy: { createdAt: "desc" }, take: 10 },
            },
        });
        if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

        const balance = await computeSupplierBalance(id);
        let running = balance;
        const ledgerWithBalances = supplier.ledger.map((e, idx) => {
            if (idx > 0) {
                const prev = supplier.ledger[idx - 1];
                running -= (prev.debit - prev.credit);
            }
            return { ...e, balance: running };
        });

        const obEntry = await prisma.supplierLedger.findFirst({
            where: { supplierId: id, type: 'OPENING_BALANCE' }
        });
        const openingBalance = obEntry ? obEntry.amount : 0;
        const openingBalanceType = obEntry ? (obEntry.debit > 0 ? 'CREDIT' : 'DEBIT') : 'CREDIT';

        res.json({
            ...supplier,
            ledger: ledgerWithBalances,
            balance,
            openingBalance,
            openingBalanceType
        });
    } catch {
        res.status(500).json({ error: "Failed to fetch supplier" });
    }
};

export const createSupplier = async (req: Request, res: Response): Promise<void> => {
    const { name, phone, address, email, bankDetails, paymentTerms, taxId, openingBalance, openingBalanceType } = req.body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    try {
        const obVal = typeof openingBalance === 'number' ? openingBalance : null;
        if (obVal !== null && obVal !== 0) {
            const supplier = await prisma.$transaction(async (tx) => {
                const s = await tx.supplier.create({
                    data: { name, phone, address, email, bankDetails, paymentTerms, taxId },
                });

                let debit = 0;
                let credit = 0;
                if (openingBalanceType) {
                    const typeUpper = String(openingBalanceType).toUpperCase();
                    if (typeUpper === 'CREDIT') {
                        debit = Math.abs(obVal);
                    } else {
                        credit = Math.abs(obVal);
                    }
                } else {
                    debit = obVal > 0 ? obVal : 0;
                    credit = obVal < 0 ? Math.abs(obVal) : 0;
                }

                await tx.supplierLedger.create({
                    data: {
                        supplierId: s.id,
                        type: 'OPENING_BALANCE',
                        debit,
                        credit,
                        note: 'Opening balance',
                    },
                });
                return s;
            });
            const balance = await computeSupplierBalance(supplier.id);
            res.status(201).json({ ...supplier, balance });
        } else {
            const supplier = await prisma.supplier.create({
                data: { name, phone, address, email, bankDetails, paymentTerms, taxId },
            });
            res.status(201).json({ ...supplier, balance: 0 });
        }
    } catch {
        res.status(500).json({ error: "Failed to create supplier" });
    }
};

export const updateSupplier = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { name, phone, address, email, bankDetails, paymentTerms, taxId, active, openingBalance, openingBalanceType } = req.body;
    try {
        const supplier = await prisma.$transaction(async (tx) => {
            const s = await tx.supplier.update({
                where: { id },
                data: { name, phone, address, email, bankDetails, paymentTerms, taxId, active },
            });

            if (openingBalance !== undefined) {
                const obVal = typeof openingBalance === 'number' ? openingBalance : 0;
                
                // Find existing OPENING_BALANCE ledger entry
                const existingOB = await tx.supplierLedger.findFirst({
                    where: { supplierId: id, type: 'OPENING_BALANCE' },
                });

                if (obVal === 0) {
                    // If opening balance is updated to 0, delete the ledger entry
                    if (existingOB) {
                        await tx.supplierLedger.delete({
                            where: { id: existingOB.id },
                        });
                    }
                } else {
                    let debit = 0;
                    let credit = 0;
                    if (openingBalanceType) {
                        const typeUpper = String(openingBalanceType).toUpperCase();
                        if (typeUpper === 'CREDIT') {
                            debit = Math.abs(obVal);
                        } else {
                            credit = Math.abs(obVal);
                        }
                    } else {
                        debit = obVal > 0 ? obVal : 0;
                        credit = obVal < 0 ? Math.abs(obVal) : 0;
                    }

                    if (existingOB) {
                        await tx.supplierLedger.update({
                            where: { id: existingOB.id },
                            data: { debit, credit, amount: Math.abs(obVal) },
                        });
                    } else {
                        await tx.supplierLedger.create({
                            data: {
                                supplierId: id,
                                type: 'OPENING_BALANCE',
                                debit,
                                credit,
                                note: 'Opening balance',
                            },
                        });
                    }
                }
            }
            return s;
        });

        const balance = await computeSupplierBalance(id);
        res.json({ ...supplier, balance });
    } catch (err) {
        console.error("Error updating supplier:", err);
        res.status(500).json({ error: "Failed to update supplier" });
    }
};

export const deleteSupplier = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        await prisma.supplier.delete({ where: { id } });
        res.json({ message: "Supplier deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete supplier — it may be in use" });
    }
};

// ---- SUPPLIER LEDGER ----

export const listSupplierLedger = async (req: Request, res: Response): Promise<void> => {
    const supplierId = parseInt(req.params.id);
    const { page, pageSize, skip } = getPaginationParams(req);
    try {
        const [entries, total] = await Promise.all([
            prisma.supplierLedger.findMany({
                where: { supplierId },
                skip, take: pageSize,
                orderBy: { createdAt: "desc" },
            }),
            prisma.supplierLedger.count({ where: { supplierId } }),
        ]);

        let running = 0;
        if (entries.length > 0) {
            const agg = await prisma.supplierLedger.aggregate({
                where: {
                    supplierId,
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
        res.status(500).json({ error: "Failed to fetch supplier ledger" });
    }
};

export const createSupplierLedgerEntry = async (req: Request, res: Response): Promise<void> => {
    const supplierId = parseInt(req.params.id);
    const { type, amount, debit, credit, note, reference, referenceId } = req.body;
    const VALID_TYPES = ["PURCHASE", "PAYMENT", "PURCHASE_RETURN", "ADJUSTMENT_DR", "ADJUSTMENT_CR", "OPENING_BALANCE"];
    if (!type || (!amount && !debit && !credit)) { res.status(400).json({ error: "type and amount (or debit/credit) are required" }); return; }
    if (!VALID_TYPES.includes(type)) {
        res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` });
        return;
    }
    try {
        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

        const CREDIT_TYPES = ["PAYMENT", "PURCHASE_RETURN", "ADJUSTMENT_CR"];
        const isCredit = CREDIT_TYPES.includes(type);
        const absAmount = Math.abs(amount || debit || credit || 0);
        const entryDebit = debit ? Math.abs(debit) : (isCredit ? 0 : absAmount);
        const entryCredit = credit ? Math.abs(credit) : (isCredit ? absAmount : 0);

        const entry = await prisma.supplierLedger.create({
            data: { supplierId, type, amount: absAmount, debit: entryDebit, credit: entryCredit, note, reference, referenceId },
        });
        res.status(201).json(entry);
    } catch {
        res.status(500).json({ error: "Failed to create ledger entry" });
    }
};

// ---- SUPPLIER PAYMENTS ----

export const listSupplierPayments = async (req: Request, res: Response): Promise<void> => {
    const supplierId = parseInt(req.params.id);
    const { page, pageSize, skip } = getPaginationParams(req);
    try {
        const [payments, total] = await Promise.all([
            prisma.supplierPayment.findMany({
                where: { supplierId },
                skip, take: pageSize,
                orderBy: { createdAt: "desc" },
                include: { account: true },
            }),
            prisma.supplierPayment.count({ where: { supplierId } }),
        ]);
        res.json(createPaginatedResponse(payments, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch payments" });
    }
};

export const createSupplierPayment = async (req: Request, res: Response): Promise<void> => {
    const supplierId = parseInt(req.params.id);
    const { amount, accountId, note, date, type } = req.body;
    if (!amount || !accountId) {
        res.status(400).json({ error: "amount and accountId are required" });
        return;
    }
    try {
        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

        const paymentDate = date ? new Date(date) : new Date();
        const pType = type === "RECEIVED" ? "RECEIVED" : "SENT";

        let debit = 0;
        let credit = 0;
        if (pType === "RECEIVED") {
            debit = Math.abs(amount);
        } else {
            credit = Math.abs(amount);
        }

        const [payment] = await prisma.$transaction([
            prisma.supplierPayment.create({
                data: { supplierId, amount: Math.abs(amount), type: pType, accountId, note, date: paymentDate },
                include: { account: true },
            }),
            prisma.supplierLedger.create({
                data: {
                    supplierId,
                    type: "PAYMENT",
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
        console.error("Error creating supplier payment:", err);
        res.status(500).json({ error: "Failed to create payment" });
    }
};
