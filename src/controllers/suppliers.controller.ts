import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

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
        res.json(createPaginatedResponse(suppliers, total, page, pageSize));
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
        res.json(supplier);
    } catch {
        res.status(500).json({ error: "Failed to fetch supplier" });
    }
};

export const createSupplier = async (req: Request, res: Response): Promise<void> => {
    const { name, phone, address, email, bankDetails, paymentTerms, taxId } = req.body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    try {
        const supplier = await prisma.supplier.create({
            data: { name, phone, address, email, bankDetails, paymentTerms, taxId },
        });
        res.status(201).json(supplier);
    } catch {
        res.status(500).json({ error: "Failed to create supplier" });
    }
};

export const updateSupplier = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { name, phone, address, email, bankDetails, paymentTerms, taxId, active } = req.body;
    try {
        const supplier = await prisma.supplier.update({
            where: { id },
            data: { name, phone, address, email, bankDetails, paymentTerms, taxId, active },
        });
        res.json(supplier);
    } catch {
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
        res.json(createPaginatedResponse(entries, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch supplier ledger" });
    }
};

export const createSupplierLedgerEntry = async (req: Request, res: Response): Promise<void> => {
    const supplierId = parseInt(req.params.id);
    const { type, amount, note, reference, referenceId } = req.body;
    const VALID_TYPES = ["PURCHASE", "PAYMENT", "PURCHASE_RETURN", "ADJUSTMENT_DR", "ADJUSTMENT_CR", "OPENING_BALANCE"];
    if (!type || !amount) { res.status(400).json({ error: "type and amount are required" }); return; }
    if (!VALID_TYPES.includes(type)) {
        res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` });
        return;
    }
    try {
        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

        const CREDIT_TYPES = ["PAYMENT", "PURCHASE_RETURN", "ADJUSTMENT_CR"];
        const delta = CREDIT_TYPES.includes(type) ? -Math.abs(amount) : Math.abs(amount);
        const newBalance = supplier.balance + delta;

        const [entry] = await prisma.$transaction([
            prisma.supplierLedger.create({
                data: { supplierId, type, amount: Math.abs(amount), balance: newBalance, note, reference, referenceId },
            }),
            prisma.supplier.update({ where: { id: supplierId }, data: { balance: newBalance } }),
        ]);
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
    const { amount, accountId, note, date } = req.body;
    if (!amount || !accountId) {
        res.status(400).json({ error: "amount and accountId are required" });
        return;
    }
    try {
        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

        const newBalance = supplier.balance - Math.abs(amount);
        const paymentDate = date ? new Date(date) : new Date();

        const [payment] = await prisma.$transaction([
            prisma.supplierPayment.create({
                data: { supplierId, amount: Math.abs(amount), accountId, note, date: paymentDate },
                include: { account: true },
            }),
            prisma.supplierLedger.create({
                data: {
                    supplierId, type: "PAYMENT",
                    amount: Math.abs(amount), balance: newBalance,
                    note, reference: `PMT-${Date.now()}`,
                },
            }),
            prisma.supplier.update({ where: { id: supplierId }, data: { balance: newBalance } }),
        ]);
        res.status(201).json(payment);
    } catch {
        res.status(500).json({ error: "Failed to create payment" });
    }
};
