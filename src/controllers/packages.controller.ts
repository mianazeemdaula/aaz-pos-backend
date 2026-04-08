import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

export const listPackages = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip, q } = getPaginationParams(req);
    const where: any = {};
    if (q) {
        where.OR = [
            { name: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
        ];
    }
    if (req.query.active !== undefined) where.active = req.query.active === "true";

    try {
        const [packages, total] = await Promise.all([
            prisma.package.findMany({
                where, skip, take: pageSize,
                orderBy: { name: "asc" },
                include: { packageItems: { include: { variant: { include: { product: true } } } } },
            }),
            prisma.package.count({ where }),
        ]);
        res.json(createPaginatedResponse(packages, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch packages" });
    }
};

export const getPackage = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const pkg = await prisma.package.findUnique({
            where: { id },
            include: { packageItems: { include: { variant: { include: { product: true } } } } },
        });
        if (!pkg) { res.status(404).json({ error: "Package not found" }); return; }
        res.json(pkg);
    } catch {
        res.status(500).json({ error: "Failed to fetch package" });
    }
};

export const createPackage = async (req: Request, res: Response): Promise<void> => {
    const { name, code, description, price, discount, active, items } = req.body;
    if (!name || !code || price === undefined) {
        res.status(400).json({ error: "name, code and price are required" });
        return;
    }
    try {
        const pkg = await prisma.package.create({
            data: {
                name, code, description, price,
                discount: discount ?? 0,
                active: active ?? true,
                packageItems: items?.length ? {
                    create: items.map((item: any) => ({
                        variantId: item.variantId,
                        quantity: item.quantity,
                    })),
                } : undefined,
            },
            include: { packageItems: { include: { variant: true } } },
        });
        res.status(201).json(pkg);
    } catch {
        res.status(500).json({ error: "Failed to create package — code may already exist" });
    }
};

export const updatePackage = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { name, code, description, price, discount, active } = req.body;
    try {
        if (code) {
            const existing = await prisma.package.findFirst({ where: { code, NOT: { id } } });
            if (existing) { res.status(409).json({ error: "Package code already in use" }); return; }
        }
        const pkg = await prisma.package.update({
            where: { id },
            data: { name, code, description, price, discount, active },
        });
        res.json(pkg);
    } catch {
        res.status(500).json({ error: "Failed to update package" });
    }
};

export const deletePackage = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        await prisma.package.delete({ where: { id } });
        res.json({ message: "Package deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete package" });
    }
};

export const addPackageItem = async (req: Request, res: Response): Promise<void> => {
    const packageId = parseInt(req.params.id);
    const { variantId, quantity } = req.body;
    if (!variantId || !quantity) {
        res.status(400).json({ error: "variantId and quantity are required" });
        return;
    }
    try {
        const item = await prisma.packageItem.create({
            data: { packageId, variantId, quantity },
            include: { variant: { include: { product: true } } },
        });
        res.status(201).json(item);
    } catch {
        res.status(500).json({ error: "Failed to add package item" });
    }
};

export const removePackageItem = async (req: Request, res: Response): Promise<void> => {
    const itemId = parseInt(req.params.itemId);
    try {
        await prisma.packageItem.delete({ where: { id: itemId } });
        res.json({ message: "Package item removed" });
    } catch {
        res.status(500).json({ error: "Failed to remove package item" });
    }
};
