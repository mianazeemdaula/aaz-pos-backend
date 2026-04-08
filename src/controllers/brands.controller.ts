import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

export const listBrands = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip, q } = getPaginationParams(req);
    const where: any = {};
    if (q) where.name = { contains: q, mode: "insensitive" };
    if (req.query.active !== undefined) where.active = req.query.active === "true";

    try {
        const [brands, total] = await Promise.all([
            prisma.brand.findMany({ where, skip, take: pageSize, orderBy: { name: "asc" } }),
            prisma.brand.count({ where }),
        ]);
        res.json(createPaginatedResponse(brands, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch brands" });
    }
};

export const getBrand = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const brand = await prisma.brand.findUnique({ where: { id } });
        if (!brand) { res.status(404).json({ error: "Brand not found" }); return; }
        res.json(brand);
    } catch {
        res.status(500).json({ error: "Failed to fetch brand" });
    }
};

export const createBrand = async (req: Request, res: Response): Promise<void> => {
    const { name, active } = req.body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    try {
        const brand = await prisma.brand.create({ data: { name, active } });
        res.status(201).json(brand);
    } catch {
        res.status(500).json({ error: "Failed to create brand — name may already exist" });
    }
};

export const updateBrand = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { name, active } = req.body;
    try {
        const brand = await prisma.brand.update({ where: { id }, data: { name, active } });
        res.json(brand);
    } catch {
        res.status(500).json({ error: "Failed to update brand" });
    }
};

export const deleteBrand = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        await prisma.brand.delete({ where: { id } });
        res.json({ message: "Brand deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete brand — it may be in use" });
    }
};
