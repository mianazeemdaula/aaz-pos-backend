import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

const VALID_TYPES = ["PURCHASE", "SALE", "SALE_RETURN", "PURCHASE_RETURN", "ADJUSTMENT", "OPENING"];

export const listStockMovements = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip } = getPaginationParams(req);
    const where: any = {};
    if (req.query.productId) where.productId = parseInt(req.query.productId as string);
    if (req.query.type) where.type = req.query.type;
    if (req.query.from || req.query.to) {
        where.createdAt = {};
        if (req.query.from) where.createdAt.gte = new Date(req.query.from as string);
        if (req.query.to) where.createdAt.lte = new Date(req.query.to as string);
    }

    try {
        const [movements, total] = await Promise.all([
            prisma.stockMovement.findMany({
                where, skip, take: pageSize,
                orderBy: { createdAt: "desc" },
                include: { product: { select: { id: true, name: true } } },
            }),
            prisma.stockMovement.count({ where }),
        ]);
        res.json(createPaginatedResponse(movements, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch stock movements" });
    }
};

export const createStockAdjustment = async (req: Request, res: Response): Promise<void> => {
    const { productId, quantity, note, accountId } = req.body;
    if (!productId || quantity === undefined) {
        res.status(400).json({ error: "productId and quantity are required" });
        return;
    }
    try {
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) { res.status(404).json({ error: "Product not found" }); return; }

        const newStock = product.totalStock + quantity;
        if (newStock < 0 && !product.allowNegative) {
            res.status(400).json({ error: "Insufficient stock" });
            return;
        }

        const [movement] = await prisma.$transaction([
            prisma.stockMovement.create({
                data: { productId, type: "ADJUSTMENT", quantity, note, accountId },
            }),
            prisma.product.update({
                where: { id: productId },
                data: { totalStock: newStock },
            }),
        ]);
        res.status(201).json(movement);
    } catch {
        res.status(500).json({ error: "Failed to create stock adjustment" });
    }
};
