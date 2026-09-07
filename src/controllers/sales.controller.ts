import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils";
import { submitSale, isSaleError, type SaleRequestInput } from "../services/sales";

export const listSales = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip } = getPaginationParams(req);
    const where: any = {};
    if (req.query.id) where.id = parseInt(req.query.id as string);
    if (req.query.customerId) where.customerId = parseInt(req.query.customerId as string);
    if (req.query.userId) where.userId = parseInt(req.query.userId as string);

    // type=RETURN → only transactions with negative totalAmount (returns)
    // type=SALE   → only positive totalAmount (regular sales)
    if (req.query.type === 'RETURN') where.totalAmount = { lt: 0 };
    else if (req.query.type === 'SALE') where.totalAmount = { gte: 0 };

    if (req.query.from || req.query.to) {
        where.createdAt = {};
        if (req.query.from) where.createdAt.gte = new Date(`${req.query.from}T00:00:00.000`);
        if (req.query.to) where.createdAt.lte = new Date(`${req.query.to}T23:59:59.999`);
    }

    const qRaw = (req.query.q ?? req.query.search) as string | undefined;
    if (qRaw && qRaw.trim()) {
        const q = qRaw.trim();
        const cleanIdStr = q.replace(/[^0-9]/g, '');
        const numericId = cleanIdStr.length > 0 && !isNaN(Number(cleanIdStr)) ? Number(cleanIdStr) : null;

        const OR: any[] = [
            { customer: { name: { contains: q, mode: 'insensitive' } } },
            { customer: { phone: { contains: q, mode: 'insensitive' } } },
            { taxInvoiceId: { contains: q, mode: 'insensitive' } },
            { note: { contains: q, mode: 'insensitive' } },
            { user: { name: { contains: q, mode: 'insensitive' } } },
            {
                items: {
                    some: {
                        OR: [
                            { variant: { barcode: { contains: q, mode: 'insensitive' } } },
                            { variant: { product: { name: { contains: q, mode: 'insensitive' } } } }
                        ]
                    }
                }
            }
        ];

        if (numericId !== null) {
            OR.push({ id: numericId });
            OR.push({ parentSaleId: numericId });
        }

        where.OR = OR;
    }

    try {
        const [sales, total] = await Promise.all([
            prisma.sale.findMany({
                where, skip, take: pageSize,
                orderBy: { createdAt: "desc" },
                include: {
                    items: true,
                    customer: { select: { id: true, name: true } },
                    user: { select: { id: true, name: true } },
                    payments: { include: { account: true } },
                },
            }),
            prisma.sale.count({ where }),
        ]);
        res.json(createPaginatedResponse(sales, total, page, pageSize));
    } catch (error) {
        // A bare `catch {}` here hid a broken search filter for months:
        // the endpoint returned a generic 500 and the screen just showed
        // no results. Log the cause.
        console.error("listSales error:", error);
        res.status(500).json({ error: "Failed to fetch sales" });
    }
};

export const getSale = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const sale = await prisma.sale.findUnique({
            where: { id },
            include: {
                customer: true,
                user: { select: { id: true, name: true, username: true } },
                items: { include: { variant: { include: { product: true } } } },
                payments: { include: { account: true } },
                parentSale: { select: { id: true, taxInvoiceId: true } },
                returns: {
                    include: {
                        items: { include: { variant: { include: { product: true } } } },
                        payments: { include: { account: true } }
                    }
                }
            },
        });
        if (!sale) { res.status(404).json({ error: "Sale not found" }); return; }
        const enriched = await enrichSaleWithCustomerBalances(sale);
        res.json(enriched);
    } catch {
        res.status(500).json({ error: "Failed to fetch sale" });
    }
};

export const createSale = async (req: Request, res: Response): Promise<void> => {
    try {
        const sale = await submitSale(req.body as SaleRequestInput, req.user?.id ?? null);
        const enriched = await enrichSaleWithCustomerBalances(sale);
        res.status(201).json(enriched);
    } catch (err) {
        if (isSaleError(err)) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        console.error("Error creating sale:", err);
        res.status(500).json({ error: "Failed to create sale" });
    }
};

export const updateSale = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { customerId, note, taxInvoiceId } = req.body;

    try {
        const sale = await prisma.sale.findUnique({ where: { id } });
        if (!sale) {
            res.status(404).json({ error: "Sale not found" });
            return;
        }

        const result = await prisma.$transaction(async (tx) => {
            const updateData: any = {};
            if (note !== undefined) updateData.note = note;
            if (taxInvoiceId !== undefined) updateData.taxInvoiceId = taxInvoiceId;

            // Handle customer change with ledger transfer
            if (customerId !== undefined && customerId !== sale.customerId) {
                updateData.customerId = customerId ? Number(customerId) : null;

                // Delete old customer's ledger entries for this sale
                if (sale.customerId) {
                    await tx.customerLedger.deleteMany({
                        where: { customerId: sale.customerId, referenceId: sale.id },
                    });
                }

                // Create new customer's ledger entries
                if (customerId) {
                    const amountDue = sale.totalAmount - sale.paidAmount;
                    if (amountDue !== 0) {
                        const isReturnTx = amountDue < 0;
                        const message = isReturnTx
                            ? `Customer returned items worth Rs ${Math.abs(amountDue)}`
                            : `Bill amount Rs ${sale.totalAmount} with payments Rs ${sale.paidAmount} Invoice # ${sale.id}`;
                        await tx.customerLedger.create({
                            data: {
                                customerId: Number(customerId),
                                type: isReturnTx ? "SALE_RETURN" : "SALE",
                                amount: Math.abs(amountDue),
                                debit: isReturnTx ? 0 : Math.abs(amountDue),
                                credit: isReturnTx ? Math.abs(amountDue) : 0,
                                referenceId: sale.id,
                                reference: message,
                            },
                        });
                    }
                }
            }

            const updated = await tx.sale.update({
                where: { id },
                data: updateData,
                include: {
                    items: true,
                    customer: true,
                    payments: { include: { account: true } },
                },
            });
            return updated;
        });

        res.json(result);
    } catch (err) {
        console.error("Error updating sale:", err);
        res.status(500).json({ error: "Failed to update sale" });
    }
};

export const updateSaleTaxInvoice = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { taxInvoiceId } = req.body;
    if (!taxInvoiceId || typeof taxInvoiceId !== 'string') {
        res.status(400).json({ error: "taxInvoiceId is required" });
        return;
    }
    try {
        const sale = await prisma.sale.update({
            where: { id },
            data: { taxInvoiceId },
        });
        res.json(sale);
    } catch {
        res.status(500).json({ error: "Failed to update tax invoice ID" });
    }
};

export const deleteSale = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        // Only cascade-delete the sale; stock/ledger reversal requires a full return workflow
        await prisma.sale.delete({ where: { id } });
        res.json({ message: "Sale deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete sale" });
    }
};

async function enrichSaleWithCustomerBalances(sale: any) {
    if (!sale || !sale.customer || !sale.customerId) return sale;

    // Find the ledger entry for this sale
    const ledgerEntry = await prisma.customerLedger.findFirst({
        where: {
            customerId: sale.customerId,
            referenceId: sale.id,
            type: { in: ["SALE", "SALE_RETURN"] }
        }
    });

    let previousBalance = 0;
    let newBalance = 0;

    if (ledgerEntry) {
        // Sum of all debits/credits created BEFORE this ledger entry
        const aggBefore = await prisma.customerLedger.aggregate({
            where: {
                customerId: sale.customerId,
                id: { lt: ledgerEntry.id }
            },
            _sum: { debit: true, credit: true }
        });
        previousBalance = (aggBefore._sum.debit ?? 0) - (aggBefore._sum.credit ?? 0);
        newBalance = previousBalance + (ledgerEntry.debit - ledgerEntry.credit);
    } else {
        // No ledger entry exists (meaning no balance due/fully paid),
        // we can aggregate ledger entries created before the sale's createdAt
        const aggBefore = await prisma.customerLedger.aggregate({
            where: {
                customerId: sale.customerId,
                createdAt: { lt: sale.createdAt }
            },
            _sum: { debit: true, credit: true }
        });
        previousBalance = (aggBefore._sum.debit ?? 0) - (aggBefore._sum.credit ?? 0);
        newBalance = previousBalance;
    }

    // Attach to customer
    sale.customer = {
        ...sale.customer,
        previousBalance,
        newBalance
    };

    return sale;
}

