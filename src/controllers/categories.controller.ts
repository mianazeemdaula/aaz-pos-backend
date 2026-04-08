import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { createPaginatedResponse, getPaginationParams } from "../utils/pagination";

export const listCategories = async (req: Request, res: Response): Promise<void> => {
    const { q } = getPaginationParams(req);
    const where: any = {};
    if (q) where.name = { contains: q, mode: "insensitive" };
    if (req.query.parentId !== undefined) {
        where.parentId = req.query.parentId === "null" ? null : parseInt(req.query.parentId as string);
    }

    try {
        const categories = await prisma.category.findMany({
            where,
            orderBy: { name: "asc" },
            include: { subcategories: true },
        });
        res.json(createPaginatedResponse(categories, categories.length, 1, categories.length));
    } catch {
        res.status(500).json({ error: "Failed to fetch categories" });
    }
};

export const getCategory = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const category = await prisma.category.findUnique({
            where: { id },
            include: { subcategories: true, parent: true },
        });
        if (!category) { res.status(404).json({ error: "Category not found" }); return; }
        res.json(category);
    } catch {
        res.status(500).json({ error: "Failed to fetch category" });
    }
};

export const createCategory = async (req: Request, res: Response): Promise<void> => {
    const { name, parentId } = req.body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    try {
        const category = await prisma.category.create({
            data: { name, parentId },
        });
        res.status(201).json(category);
    } catch {
        res.status(500).json({ error: "Failed to create category — name may already exist under this parent" });
    }
};

export const updateCategory = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { name, parentId } = req.body;
    try {
        const category = await prisma.category.update({
            where: { id },
            data: { name, parentId },
        });
        res.json(category);
    } catch {
        res.status(500).json({ error: "Failed to update category" });
    }
};

export const deleteCategory = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        await prisma.category.delete({ where: { id } });
        res.json({ message: "Category deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete category — it may have subcategories or products" });
    }
};

export const treeCategories = async (req: Request, res: Response): Promise<void> => {
    try {
        const categories = await prisma.category.findMany({
            where: { parentId: null },
            orderBy: { name: "asc" },
            include: {
                subcategories: {
                    orderBy: { name: "asc" },
                    include: { subcategories: { orderBy: { name: "asc" } }, _count: { select: { products: true } } },
                },
                _count: { select: { products: true } },
            },
        });
        res.json(createPaginatedResponse(categories, categories.length, 1, categories.length));
    } catch {
        res.status(500).json({ error: "Failed to fetch category tree" });
    }
};
