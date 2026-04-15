import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

export const listPromotions = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip, q } = getPaginationParams(req);
    const where: any = {};
    if (q) where.name = { contains: q, mode: "insensitive" };
    if (req.query.active !== undefined) where.active = req.query.active === "true";

    try {
        const [promotions, total] = await Promise.all([
            prisma.promotion.findMany({
                where, skip, take: pageSize,
                orderBy: { startDate: "desc" },
                include: { promotionItems: { include: { variant: { include: { product: true } } } } },
            }),
            prisma.promotion.count({ where }),
        ]);
        res.json(createPaginatedResponse(promotions, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch promotions" });
    }
};

export const getPromotion = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const promotion = await prisma.promotion.findUnique({
            where: { id },
            include: { promotionItems: { include: { variant: { include: { product: true } } } } },
        });
        if (!promotion) { res.status(404).json({ error: "Promotion not found" }); return; }
        res.json(promotion);
    } catch {
        res.status(500).json({ error: "Failed to fetch promotion" });
    }
};

export const createPromotion = async (req: Request, res: Response): Promise<void> => {
    const { name, description, startDate, endDate, discountType, discountValue, conditionType, minPurchaseAmount, active, variantIds } = req.body;
    const VALID_DISCOUNT_TYPES = ["PERCENTAGE", "FIXED_AMOUNT"];
    const VALID_CONDITIONS = ["ALL_CUSTOMERS", "MINIMUM_PURCHASE", "REPEAT_CUSTOMERS", "PRODUCT_SPECIFIC"];

    if (!name || !startDate || !endDate || !discountType || discountValue === undefined || !conditionType) {
        res.status(400).json({ error: "name, startDate, endDate, discountType, discountValue and conditionType are required" });
        return;
    }
    if (!VALID_DISCOUNT_TYPES.includes(discountType)) {
        res.status(400).json({ error: `discountType must be one of: ${VALID_DISCOUNT_TYPES.join(", ")}` });
        return;
    }
    if (!VALID_CONDITIONS.includes(conditionType)) {
        res.status(400).json({ error: `conditionType must be one of: ${VALID_CONDITIONS.join(", ")}` });
        return;
    }

    try {
        const promotion = await prisma.promotion.create({
            data: {
                name, description, discountType, discountValue, conditionType,
                minPurchaseAmount, active: active ?? true,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                promotionItems: variantIds?.length ? {
                    create: variantIds.map((variantId: number) => ({ variantId })),
                } : undefined,
            },
            include: { promotionItems: { include: { variant: true } } },
        });
        res.status(201).json(promotion);
    } catch {
        res.status(500).json({ error: "Failed to create promotion" });
    }
};

export const updatePromotion = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { name, description, startDate, endDate, discountType, discountValue, conditionType, minPurchaseAmount, active, variantIds } = req.body;
    try {
        const promotion = await prisma.$transaction(async (tx) => {
            const updated = await tx.promotion.update({
                where: { id },
                data: {
                    name, description, discountType, discountValue, conditionType,
                    minPurchaseAmount, active,
                    startDate: startDate ? new Date(startDate) : undefined,
                    endDate: endDate ? new Date(endDate) : undefined,
                },
            });
            if (Array.isArray(variantIds)) {
                await tx.promotionItems.deleteMany({ where: { promotionId: id } });
                if (variantIds.length > 0) {
                    await tx.promotionItems.createMany({
                        data: variantIds.map((variantId: number) => ({ promotionId: id, variantId })),
                    });
                }
            }
            return tx.promotion.findUnique({
                where: { id: updated.id },
                include: { promotionItems: { include: { variant: { include: { product: true } } } } },
            });
        });
        res.json(promotion);
    } catch {
        res.status(500).json({ error: "Failed to update promotion" });
    }
};

export const deletePromotion = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        await prisma.promotion.delete({ where: { id } });
        res.json({ message: "Promotion deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete promotion" });
    }
};

export const getActivePromotions = async (req: Request, res: Response): Promise<void> => {
    const now = new Date();
    try {
        const promotions = await prisma.promotion.findMany({
            where: { active: true, startDate: { lte: now }, endDate: { gte: now } },
            include: { promotionItems: { include: { variant: true } } },
        });
        res.json(promotions);
    } catch {
        res.status(500).json({ error: "Failed to fetch active promotions" });
    }
};
