import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";

export const listTaxSchedules = async (_req: Request, res: Response): Promise<void> => {
    try {
        const schedules = await prisma.taxSchdule.findMany({
            orderBy: { name: "asc" },
        });
        res.json(schedules);
    } catch {
        res.status(500).json({ error: "Failed to fetch tax schedules" });
    }
};

export const getTaxSchedule = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const schedule = await prisma.taxSchdule.findUnique({
            where: { id },
            include: { products: { select: { id: true, name: true } } },
        });
        if (!schedule) { res.status(404).json({ error: "Tax schedule not found" }); return; }
        res.json(schedule);
    } catch {
        res.status(500).json({ error: "Failed to fetch tax schedule" });
    }
};
