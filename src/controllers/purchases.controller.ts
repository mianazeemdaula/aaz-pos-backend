import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

export const listPurchases = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip } = getPaginationParams(req);
    const where: any = {};
    if (req.query.supplierId) where.supplierId = parseInt(req.query.supplierId as string);
    if (req.query.userId) where.userId = parseInt(req.query.userId as string);
    // type=RETURN → only transactions with negative totalAmount (returns)
    // type=PURCHASE → only positive totalAmount (regular purchases)
    if (req.query.type === 'RETURN') where.totalAmount = { lt: 0 };
    else if (req.query.type === 'PURCHASE') where.totalAmount = { gte: 0 };
    if (req.query.from || req.query.to) {
        where.date = {};
        if (req.query.from) where.date.gte = new Date(req.query.from as string);
        if (req.query.to) {
            const toDate = new Date(req.query.to as string);
            toDate.setHours(23, 59, 59, 999);
            where.date.lte = toDate;
        }
    }

    try {
        const [purchases, total] = await Promise.all([
            prisma.purchase.findMany({
                where, skip, take: pageSize,
                orderBy: { date: "desc" },
                include: {
                    supplier: { select: { id: true, name: true } },
                    user: { select: { id: true, name: true } },
                    account: true,
                    payments: { include: { account: true } },
                },
            }),
            prisma.purchase.count({ where }),
        ]);
        res.json(createPaginatedResponse(purchases, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch purchases" });
    }
};

export const getPurchase = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const purchase = await prisma.purchase.findUnique({
            where: { id },
            include: {
                supplier: true,
                user: { select: { id: true, name: true } },
                account: true,
                payments: { include: { account: true } },
                items: { include: { product: true } },
            },
        });
        if (!purchase) { res.status(404).json({ error: "Purchase not found" }); return; }
        res.json(purchase);
    } catch {
        res.status(500).json({ error: "Failed to fetch purchase" });
    }
};

export const createPurchase = async (req: Request, res: Response): Promise<void> => {
    const {
        invoiceNo, supplierId, accountId, items,
        discount = 0, taxAmount = 0, expenses = 0, date,
        paidAmount: rawPaidAmount,
        payments = [],
    } = req.body;
    const userId = req.user?.id;

    // Support both multi-payment array and legacy single accountId/paidAmount
    const paymentEntries: { accountId: number; amount: number; note?: string }[] = payments.length > 0
        ? payments
        : (accountId && rawPaidAmount ? [{ accountId, amount: Number(rawPaidAmount) }] : []);
    const paidAmount = paymentEntries.reduce((s: number, p: { amount: number }) => s + p.amount, 0);


    try {
        // Validate products
        const productIds: number[] = items.map((i: any) => i.productId);
        const products = await prisma.product.findMany({
            where: { id: { in: productIds } },
        });
        if (products.length !== productIds.length) {
            res.status(400).json({ error: "One or more products not found" });
            return;
        }
        const productMap = new Map(products.map((p) => [p.id, p]));

        // Apply variant factor to quantity: actual stock qty = qty * factor
        const resolvedItems = items.map((item: any) => {
            const factor = item.factor && item.factor > 0 ? item.factor : 1;
            const effectiveQty = item.quantity * factor;
            return { ...item, quantity: effectiveQty, originalQty: item.quantity, factor };
        });

        const totalAmount = resolvedItems.reduce((sum: number, item: any) => {
            const itemDiscount = item.discount ?? 0;
            const itemTax = item.taxAmount ?? 0;
            return sum + (item.unitCost - itemDiscount) * item.originalQty + itemTax;
        }, 0) - discount + taxAmount + expenses;


        const purchaseDate = date ? new Date(date) : new Date();

        const result = await prisma.$transaction(async (tx) => {
            // Use first payment's accountId as the primary accountId (backward compat)
            const primaryAccountId = paymentEntries.length > 0 ? paymentEntries[0].accountId : accountId ?? null;

            const purchase = await tx.purchase.create({
                data: {
                    invoiceNo, supplierId, accountId: primaryAccountId, userId,
                    totalAmount, paidAmount, discount, taxAmount, expenses,
                    date: purchaseDate,
                    items: {
                        create: resolvedItems.map((item: any) => ({
                            productId: item.productId,
                            quantity: item.quantity,
                            unitCost: item.unitCost / item.factor,
                            sellingPrice: item.sellingPrice ?? 0,
                            discount: item.discount ?? 0,
                            taxAmount: item.taxAmount ?? 0,
                            totalCost: ((item.unitCost / item.factor - (item.discount ?? 0)) * item.originalQty) + (item.taxAmount ?? 0),
                        })),
                    },
                    payments: paymentEntries.length > 0 ? {
                        create: paymentEntries.map((p: { accountId: number; amount: number; note?: string }) => ({
                            accountId: p.accountId,
                            amount: p.amount,
                            note: p.note,
                        })),
                    } : undefined,
                },
                include: { items: true, account: true, supplier: true, payments: { include: { account: true } } },
            });

            // Update stock and weighted average cost for each product
            for (const item of resolvedItems) {
                const product = productMap.get(item.productId)!;
                const isReturnItem = item.quantity < 0;

                const newTotalStock = product.totalStock + item.quantity;
                // Only update avg cost for incoming goods (positive qty)
                let newAvgCost = product.avgCostPrice;
                if (!isReturnItem) {
                    if (product.totalStock > 0 && newTotalStock > 0) {
                        // Standard weighted average: only valid when base stock is positive
                        newAvgCost = (product.avgCostPrice * product.totalStock + (item.unitCost / item.factor) * item.quantity) / newTotalStock;
                    } else {
                        // Base stock is zero/negative (oversold), or result is still non-positive.
                        // Applying the formula on a negative base compounds errors exponentially.
                        // Reset avg cost to the new unit cost instead.
                        newAvgCost = item.unitCost / item.factor;
                    }
                }

                await tx.product.update({
                    where: { id: product.id },
                    data: { totalStock: newTotalStock, avgCostPrice: newAvgCost },
                });

                await tx.stockMovement.create({
                    data: {
                        productId: product.id,
                        type: isReturnItem ? "PURCHASE_RETURN" : "PURCHASE",
                        quantity: item.quantity,
                        reference: isReturnItem ? `PRTN-${purchase.id}` : `PO-${purchase.id}`,
                        referenceId: purchase.id,
                    },
                });
            }

            // Update supplier balance
            if (supplierId) {
                const amountDue = totalAmount - paidAmount;
                if (amountDue !== 0) {
                    const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
                    if (supplier) {
                        const newBalance = supplier.balance + amountDue;
                        await tx.supplier.update({ where: { id: supplierId }, data: { balance: newBalance } });
                        await tx.supplierLedger.create({
                            data: {
                                supplierId,
                                type: "PURCHASE",
                                amount: Math.abs(amountDue),
                                debit: Math.abs(amountDue),
                                credit: 0,
                                balance: newBalance,
                                referenceId: purchase.id,
                                reference: `PO-${purchase.id}`,
                            },
                        });
                    }
                }
            }
            return purchase;
        });

        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create purchase" });
    }
};

export const deletePurchase = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        await prisma.purchase.delete({ where: { id } });
        res.json({ message: "Purchase deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete purchase" });
    }
};


