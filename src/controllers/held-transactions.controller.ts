import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

// ---- HELD SALES ----

export const listHeldSales = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip } = getPaginationParams(req);
    const userId = req.user?.id;
    const where: any = { userId };
    if (req.query.status) where.status = req.query.status;

    try {
        const [heldSales, total] = await Promise.all([
            prisma.heldSale.findMany({
                where, skip, take: pageSize,
                orderBy: { createdAt: "desc" },
            }),
            prisma.heldSale.count({ where }),
        ]);
        res.json(createPaginatedResponse(heldSales, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch held sales" });
    }
};

export const getHeldSale = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const heldSale = await prisma.heldSale.findUnique({ where: { id } });
        if (!heldSale) { res.status(404).json({ error: "Held sale not found" }); return; }
        res.json(heldSale);
    } catch {
        res.status(500).json({ error: "Failed to fetch held sale" });
    }
};

export const createHeldSale = async (req: Request, res: Response): Promise<void> => {
    const { saleData, note } = req.body;
    const userId = req.user!.id;
    if (!saleData) { res.status(400).json({ error: "saleData is required" }); return; }
    try {
        const heldSale = await prisma.heldSale.create({
            data: { saleData, userId, note, status: "HELD" },
        });
        res.status(201).json(heldSale);
    } catch {
        res.status(500).json({ error: "Failed to hold sale" });
    }
};

export const resumeHeldSale = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const heldSale = await prisma.heldSale.update({
            where: { id },
            data: { status: "RESUMED" },
        });
        res.json(heldSale);
    } catch {
        res.status(500).json({ error: "Failed to resume held sale" });
    }
};

export const cancelHeldSale = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const heldSale = await prisma.heldSale.update({
            where: { id },
            data: { status: "CANCELLED" },
        });
        res.json(heldSale);
    } catch {
        res.status(500).json({ error: "Failed to cancel held sale" });
    }
};

// ---- HELD PURCHASES ----

export const listHeldPurchases = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip } = getPaginationParams(req);
    const userId = req.user?.id;
    const where: any = { userId };
    if (req.query.status) where.status = req.query.status;

    try {
        const [heldPurchases, total] = await Promise.all([
            prisma.heldPurchase.findMany({
                where, skip, take: pageSize,
                orderBy: { createdAt: "desc" },
            }),
            prisma.heldPurchase.count({ where }),
        ]);
        res.json(createPaginatedResponse(heldPurchases, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch held purchases" });
    }
};

export const getHeldPurchase = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const heldPurchase = await prisma.heldPurchase.findUnique({ where: { id } });
        if (!heldPurchase) { res.status(404).json({ error: "Held purchase not found" }); return; }
        res.json(heldPurchase);
    } catch {
        res.status(500).json({ error: "Failed to fetch held purchase" });
    }
};

export const createHeldPurchase = async (req: Request, res: Response): Promise<void> => {
    const { purchaseData, note } = req.body;
    const userId = req.user!.id;
    if (!purchaseData) { res.status(400).json({ error: "purchaseData is required" }); return; }
    try {
        const heldPurchase = await prisma.heldPurchase.create({
            data: { purchaseData, userId, note, status: "HELD" },
        });
        res.status(201).json(heldPurchase);
    } catch {
        res.status(500).json({ error: "Failed to hold purchase" });
    }
};

export const resumeHeldPurchase = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const heldPurchase = await prisma.heldPurchase.update({
            where: { id },
            data: { status: "RESUMED" },
        });
        res.json(heldPurchase);
    } catch {
        res.status(500).json({ error: "Failed to resume held purchase" });
    }
};

export const cancelHeldPurchase = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const heldPurchase = await prisma.heldPurchase.update({
            where: { id },
            data: { status: "CANCELLED" },
        });
        res.json(heldPurchase);
    } catch {
        res.status(500).json({ error: "Failed to cancel held purchase" });
    }
};
