import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

export const listSales = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip } = getPaginationParams(req);
    const where: any = {};
    if (req.query.customerId) where.customerId = parseInt(req.query.customerId as string);
    if (req.query.userId) where.userId = parseInt(req.query.userId as string);
    // type=RETURN → only transactions with negative totalAmount (returns)
    // type=SALE   → only positive totalAmount (regular sales)
    if (req.query.type === 'RETURN') where.totalAmount = { lt: 0 };
    else if (req.query.type === 'SALE') where.totalAmount = { gte: 0 };
    if (req.query.from || req.query.to) {
        where.createdAt = {};
        if (req.query.from) where.createdAt.gte = new Date(req.query.from as string);
        if (req.query.to) {
            const toDate = new Date(req.query.to as string);
            toDate.setHours(23, 59, 59, 999);
            where.createdAt.lte = toDate;
        }
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
    } catch {
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
            },
        });
        if (!sale) { res.status(404).json({ error: "Sale not found" }); return; }
        res.json(sale);
    } catch {
        res.status(500).json({ error: "Failed to fetch sale" });
    }
};

export const createSale = async (req: Request, res: Response): Promise<void> => {
    const {
        customerId, items, payments,
        discount = 0, taxAmount = 0,
    } = req.body;
    const userId = req.user?.id;
    if (!items?.length) {
        res.status(400).json({ error: "items are required" });
        return;
    }
    const isReturn = items.every((i: any) => Number(i.qty) < 0);
    if (!isReturn && !payments?.length && !customerId) {
        res.status(400).json({ error: "payments or customerId is required for sales" });
        return;
    }

    for (const item of items) {
        if (!item.variantId || item.qty == null || item.unitPrice == null) {
            res.status(400).json({ error: "Each item must have variantId, quantity, and unitPrice" });
            return;
        }
        if (isNaN(Number(item.qty)) || Number(item.qty) === 0) {
            res.status(400).json({ error: `Invalid quantity for variantId ${item.variantId}` });
            return;
        }
        if (isNaN(Number(item.unitPrice)) || Number(item.unitPrice) < 0) {
            res.status(400).json({ error: `Invalid unitPrice for variantId ${item.variantId}` });
            return;
        }
    }

    try {
        // Validate all variants and get product info for stock/cost snapshot
        const variantIds: number[] = items.map((i: any) => i.variantId);
        const variants = await prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            include: { product: true },
        });

        if (variants.length !== variantIds.length) {
            res.status(400).json({ error: "One or more variants not found" });
            return;
        }

        const variantMap = new Map(variants.map((v) => [v.id, v]));

        // Check stock availability (only for positive qty / regular sales)
        for (const item of items) {
            const qty = Number(item.qty);
            if (qty > 0) {
                const variant = variantMap.get(item.variantId)!;
                const newStock = variant.product.totalStock - qty * variant.factor;
                if (newStock < 0 && !variant.product.allowNegative) {
                    res.status(400).json({ error: `Insufficient stock : ${variant.product.name} [${variant.barcode}]` });
                    return;
                }
            }
        }

        // Compute totals
        const totalAmount = items.reduce((sum: number, item: any) => {
            const unitPrice = Number(item.unitPrice);
            const qty = Number(item.qty);
            const itemDiscount = item.discount ?? 0;
            return sum + (unitPrice - itemDiscount) * qty;
        }, 0) - discount + taxAmount;

        const paidAmount = payments.reduce((sum: number, p: any) => sum + p.amount, 0);
        const changeAmount = Math.max(0, paidAmount - totalAmount);

        const result = await prisma.$transaction(async (tx) => {
            // Create Sale
            const sale = await tx.sale.create({
                data: {
                    customerId: customerId ? Number(customerId) : null,
                    userId: userId ?? null,
                    totalAmount,
                    paidAmount,
                    taxAmount,
                    discount,
                    changeAmount,
                    items: {
                        create: items.map((item: any) => {
                            const variant = variantMap.get(item.variantId)!;
                            const unitPrice = Number(item.unitPrice);
                            const qty = Number(item.qty);
                            const itemDiscount = item.discount ?? 0;
                            const costPrice = variant.product.avgCostPrice > 0 ? variant.product.avgCostPrice : variant.price * 0.95; // Fallback if avgCostPrice not set
                            return {
                                variantId: item.variantId,
                                quantity: qty,
                                unitPrice,
                                discount: itemDiscount,
                                totalPrice: (unitPrice - itemDiscount) * qty,
                                avgCostPrice: costPrice,
                            };
                        }),
                    },
                    payments: {
                        create: payments.map((p: any) => ({
                            accountId: p.accountId,
                            amount: p.amount,
                            changeAmount: changeAmount ?? 0,
                            note: p.note,
                        })),
                    },
                },
                include: {
                    items: true,
                    payments: { include: { account: true } },
                    customer: true,
                },
            });

            // Update stock for each product
            for (const item of items) {
                const variant = variantMap.get(item.variantId)!;
                const qty = Number(item.qty);
                const isReturnItem = qty < 0;
                // decrement with negative qty = increment (stock returned)
                await tx.product.update({
                    where: { id: variant.productId },
                    data: { totalStock: { decrement: qty * variant.factor } },
                });
                await tx.stockMovement.create({
                    data: {
                        productId: variant.productId,
                        type: isReturnItem ? "SALE_RETURN" : "SALE",
                        quantity: -qty * variant.factor, // positive for returns, negative for sales
                        reference: isReturnItem ? `RTN-${sale.id}` : `INV-${sale.id}`,
                        referenceId: sale.id,
                    },
                });
            }

            // Update customer balance if customerId provided and there's a balance due
            if (customerId) {
                const amountDue = totalAmount - paidAmount;
                if (amountDue !== 0) {
                    const customer = await tx.customer.findUnique({ where: { id: customerId } });
                    if (customer) {
                        const newBalance = customer.balance + amountDue;
                        await tx.customer.update({ where: { id: customerId }, data: { balance: newBalance } });
                        const isReturnTx = amountDue < 0; // negative amountDue = customer gets credit
                        await tx.customerLedger.create({
                            data: {
                                customerId,
                                type: isReturnTx ? "SALE_RETURN" : "SALE",
                                amount: Math.abs(totalAmount),
                                balance: newBalance,
                                referenceId: sale.id,
                                reference: isReturnTx ? `RTN-${sale.id}` : `INV-${sale.id}`,
                            },
                        });
                    }
                }
            }
            return sale;
        });

        res.status(201).json(result);
    } catch (err) {
        console.error("Error creating sale:", err);
        res.status(500).json({ error: "Failed to create sale" });
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

