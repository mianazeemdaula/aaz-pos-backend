import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse, round2 } from "../utils";

export const listPurchases = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip } = getPaginationParams(req);
    const where: any = {};
    if (req.query.id) where.id = parseInt(req.query.id as string);
    if (req.query.supplierId) where.supplierId = parseInt(req.query.supplierId as string);
    if (req.query.userId) where.userId = parseInt(req.query.userId as string);

    // type=RETURN → only transactions with negative totalAmount (returns)
    // type=PURCHASE → only positive totalAmount (regular purchases)
    if (req.query.type === 'RETURN') where.totalAmount = { lt: 0 };
    else if (req.query.type === 'PURCHASE') where.totalAmount = { gte: 0 };

    if (req.query.from || req.query.to) {
        where.date = {};
        if (req.query.from) where.date.gte = new Date(`${req.query.from}T00:00:00.000`);
        if (req.query.to) where.date.lte = new Date(`${req.query.to}T23:59:59.999`);
    }

    const qRaw = (req.query.q ?? req.query.search) as string | undefined;
    if (qRaw && qRaw.trim()) {
        const q = qRaw.trim();
        const cleanIdStr = q.replace(/[^0-9]/g, '');
        const numericId = cleanIdStr.length > 0 && !isNaN(Number(cleanIdStr)) ? Number(cleanIdStr) : null;

        const OR: any[] = [
            { invoiceNo: { contains: q, mode: 'insensitive' } },
            { supplier: { name: { contains: q, mode: 'insensitive' } } },
            { supplier: { phone: { contains: q, mode: 'insensitive' } } },
            { note: { contains: q, mode: 'insensitive' } },
            { user: { name: { contains: q, mode: 'insensitive' } } },
            {
                items: {
                    some: {
                        product: {
                            OR: [
                                { name: { contains: q, mode: 'insensitive' } },
                                { code: { contains: q, mode: 'insensitive' } }
                            ]
                        }
                    }
                }
            }
        ];

        if (numericId !== null) {
            OR.push({ id: numericId });
            OR.push({ parentPurchaseId: numericId });
        }

        where.OR = OR;
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
                parentPurchase: { select: { id: true, invoiceNo: true } },
                returns: {
                    include: {
                        items: { include: { product: true } },
                        payments: { include: { account: true } }
                    }
                }
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
        parentPurchaseId, note,
    } = req.body;
    const userId = req.user?.id;

    // Support both multi-payment array and legacy single accountId/paidAmount
    const paymentEntries: { accountId: number; amount: number; note?: string }[] = payments.length > 0
        ? payments
        : (accountId && rawPaidAmount ? [{ accountId, amount: Number(rawPaidAmount) }] : []);
    const paidAmount = paymentEntries.reduce((s: number, p: { amount: number }) => s + p.amount, 0);


    try {
        if (!items?.length) {
            res.status(400).json({ error: "items are required" });
            return;
        }

        const isReturn = items.every((i: any) => Number(i.quantity) < 0);
        const parsedParentPurchaseId = parentPurchaseId ? Number(parentPurchaseId) : null;

        if (isReturn) {
            if (!parsedParentPurchaseId) {
                res.status(400).json({ error: "Original purchase reference (parentPurchaseId) is required for returns" });
                return;
            }
            if (!supplierId && !payments?.length) {
                res.status(400).json({ error: "Refund payment account is required for walking supplier returns" });
                return;
            }
        }

        if (parsedParentPurchaseId) {
            try {
                const parentPurchase = await prisma.purchase.findUnique({
                    where: { id: parsedParentPurchaseId },
                    include: {
                        items: true,
                        returns: { include: { items: true } },
                    },
                });
                if (!parentPurchase) {
                    res.status(404).json({ error: "Original purchase not found" });
                    return;
                }
                if (parentPurchase.totalAmount < 0) {
                    res.status(400).json({ error: "Cannot create a return against a return transaction" });
                    return;
                }
                for (const item of items) {
                    const parentItem = parentPurchase.items.find(i => i.productId === item.productId);
                    if (!parentItem) {
                        res.status(400).json({ error: `Product ID ${item.productId} was not purchased in the original purchase #${parsedParentPurchaseId}` });
                        return;
                    }
                    let alreadyReturned = 0;
                    for (const priorReturn of parentPurchase.returns) {
                        const priorItem = priorReturn.items.find(pi => pi.productId === item.productId);
                        if (priorItem) {
                            alreadyReturned += Math.abs(priorItem.quantity);
                        }
                    }
                    const remaining = parentItem.quantity - alreadyReturned;
                    const requested = Math.abs(Number(item.quantity));
                    if (requested > remaining) {
                        res.status(400).json({
                            error: `Cannot return ${requested} units of product ID ${item.productId}. Max returnable quantity is ${remaining} (Original: ${parentItem.quantity}, Already returned: ${alreadyReturned})`
                        });
                        return;
                    }
                }
            } catch (err) {
                console.error("Error validating parent purchase:", err);
                res.status(500).json({ error: "Failed to validate original purchase" });
                return;
            }
        }

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

        const totalAmount = round2(
            resolvedItems.reduce((sum: number, item: any) => {
                const itemDiscount = round2(item.discount ?? 0);
                const itemTax = round2(item.taxAmount ?? 0);
                const unitCost = round2(item.unitCost);
                return round2(sum + round2((unitCost - itemDiscount) * item.originalQty) + itemTax);
            }, 0) - round2(discount) + round2(taxAmount) + round2(expenses)
        );

        // if amount not paid means there must be a supplier
        if (totalAmount != paidAmount && !supplierId) {
            res.status(400).json({ error: 'Supplier must be selected if amount not fully paid' });
            return;
        }


        const purchaseDate = date ? new Date(date) : new Date();

        const result = await prisma.$transaction(async (tx) => {
            // Use first payment's accountId as the primary accountId (backward compat)
            const primaryAccountId = paymentEntries.length > 0 ? paymentEntries[0].accountId : accountId ?? null;

            const purchase = await tx.purchase.create({
                data: {
                    invoiceNo, supplierId, accountId: primaryAccountId, userId,
                    totalAmount,
                    paidAmount: round2(paidAmount),
                    discount: round2(discount),
                    taxAmount: round2(taxAmount),
                    expenses: round2(expenses),
                    note: note ? String(note) : null,
                    date: purchaseDate,
                    parentPurchaseId: parsedParentPurchaseId,
                    items: {
                        create: resolvedItems.map((item: any) => {
                            const unitCost = round2(item.unitCost / item.factor);
                            const itemDiscount = round2(item.discount ?? 0);
                            const itemTax = round2(item.taxAmount ?? 0);
                            const totalCost = round2(((round2(item.unitCost) - itemDiscount) * item.originalQty) + itemTax);
                            return {
                                productId: item.productId,
                                quantity: item.quantity,
                                unitCost,
                                sellingPrice: round2(item.sellingPrice ?? 0),
                                discount: itemDiscount,
                                taxAmount: itemTax,
                                totalCost,
                            };
                        }),
                    },
                    payments: paymentEntries.length > 0 ? {
                        create: paymentEntries.map((p: { accountId: number; amount: number; note?: string }) => ({
                            accountId: p.accountId,
                            amount: round2(p.amount),
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
                    const unitCostPerBaseUnit = round2(item.unitCost / item.factor);
                    if (product.totalStock > 0 && newTotalStock > 0) {
                        // Standard weighted average: only valid when base stock is positive
                        newAvgCost = round2((product.avgCostPrice * product.totalStock + unitCostPerBaseUnit * item.quantity) / newTotalStock);
                    } else {
                        // Base stock is zero/negative (oversold), or result is still non-positive.
                        newAvgCost = unitCostPerBaseUnit;
                    }
                }

                await tx.product.update({
                    where: { id: product.id },
                    data: { totalStock: newTotalStock, avgCostPrice: round2(newAvgCost) },
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

            // Create supplier ledger entry if supplierId provided and there's a balance due
            if (supplierId) {
                const amountDue = totalAmount - paidAmount;
                if (amountDue !== 0) {
                    const isReturnTx = amountDue < 0;
                    const message = isReturnTx ? `Supplier returned items worth Rs ${Math.abs(amountDue)}`
                        : `Bill amount Rs ${totalAmount} with payments Rs ${paidAmount} Purchase Order # ${purchase.id}`;
                    await tx.supplierLedger.create({
                        data: {
                            supplierId,
                            type: isReturnTx ? "PURCHASE_RETURN" : "PURCHASE",
                            amount: Math.abs(amountDue),
                            debit: isReturnTx ? 0 : Math.abs(amountDue),
                            credit: isReturnTx ? Math.abs(amountDue) : 0,
                            referenceId: purchase.id,
                            reference: message,
                        },
                    });
                }
            }
            return purchase;
        });

        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create purchase" });
    }
};

export const updatePurchase = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { supplierId, note, invoiceNo } = req.body;

    try {
        const purchase = await prisma.purchase.findUnique({ where: { id } });
        if (!purchase) {
            res.status(404).json({ error: "Purchase not found" });
            return;
        }

        const result = await prisma.$transaction(async (tx) => {
            const updateData: any = {};
            if (note !== undefined) updateData.note = note;
            if (invoiceNo !== undefined) updateData.invoiceNo = invoiceNo;

            // Handle supplier change with ledger transfer
            if (supplierId !== undefined && supplierId !== purchase.supplierId) {
                updateData.supplierId = supplierId ? Number(supplierId) : null;

                // Delete old supplier's ledger entries for this purchase
                if (purchase.supplierId) {
                    await tx.supplierLedger.deleteMany({
                        where: { supplierId: purchase.supplierId, referenceId: purchase.id },
                    });
                }

                // Create new supplier's ledger entries
                if (supplierId) {
                    const amountDue = purchase.totalAmount - purchase.paidAmount;
                    if (amountDue !== 0) {
                        const isReturnTx = amountDue < 0;
                        const message = isReturnTx
                            ? `Supplier returned items worth Rs ${Math.abs(amountDue)}`
                            : `Bill amount Rs ${purchase.totalAmount} with payments Rs ${purchase.paidAmount} Purchase Order # ${purchase.id}`;
                        await tx.supplierLedger.create({
                            data: {
                                supplierId: Number(supplierId),
                                type: isReturnTx ? "PURCHASE_RETURN" : "PURCHASE",
                                amount: Math.abs(amountDue),
                                debit: isReturnTx ? 0 : Math.abs(amountDue),
                                credit: isReturnTx ? Math.abs(amountDue) : 0,
                                referenceId: purchase.id,
                                reference: message,
                            },
                        });
                    }
                }
            }

            const updated = await tx.purchase.update({
                where: { id },
                data: updateData,
                include: {
                    items: true,
                    supplier: true,
                    payments: { include: { account: true } },
                },
            });
            return updated;
        });

        res.json(result);
    } catch (err) {
        console.error("Error updating purchase:", err);
        res.status(500).json({ error: "Failed to update purchase" });
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


