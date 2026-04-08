import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

const VALID_ROLES = ["ADMIN", "MANAGER", "CASHIER", "DELIVERY_BOY", "WORKER"];

export const listUsers = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip, q } = getPaginationParams(req);
    const where: any = {};
    if (q) {
        where.OR = [
            { name: { contains: q, mode: "insensitive" } },
            { username: { contains: q, mode: "insensitive" } },
        ];
    }
    if (req.query.role) where.role = req.query.role;
    if (req.query.status !== undefined) where.status = req.query.status === "true";

    try {
        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { createdAt: "desc" },
                select: { id: true, name: true, username: true, role: true, phone: true, address: true, status: true, createdAt: true, lastLogin: true },
            }),
            prisma.user.count({ where }),
        ]);

        res.json(createPaginatedResponse(users, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch users" });
    }
};

export const getUser = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const user = await prisma.user.findUnique({
            where: { id },
            select: { id: true, name: true, username: true, role: true, phone: true, address: true, status: true, createdAt: true, updatedAt: true, lastLogin: true },
        });
        if (!user) { res.status(404).json({ error: "User not found" }); return; }
        res.json(user);
    } catch {
        res.status(500).json({ error: "Failed to fetch user" });
    }
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
    const { name, username, password, role, phone, address } = req.body;
    if (!name || !username || !password || !role) {
        res.status(400).json({ error: "name, username, password and role are required" });
        return;
    }
    if (!VALID_ROLES.includes(role)) {
        res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
        return;
    }
    if (password.length < 6) {
        res.status(400).json({ error: "password must be at least 6 characters" });
        return;
    }
    try {
        const existing = await prisma.user.findUnique({ where: { username } });
        if (existing) { res.status(409).json({ error: "Username already taken" }); return; }
        const hash = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: { name, username, password: hash, role, phone, address },
            select: { id: true, name: true, username: true, role: true, phone: true, address: true, status: true, createdAt: true },
        });
        res.status(201).json(user);
    } catch {
        res.status(500).json({ error: "Failed to create user" });
    }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { name, username, role, phone, address, status } = req.body;
    if (role && !VALID_ROLES.includes(role)) {
        res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
        return;
    }
    try {
        if (username) {
            const existing = await prisma.user.findFirst({ where: { username, NOT: { id } } });
            if (existing) { res.status(409).json({ error: "Username already taken" }); return; }
        }
        const user = await prisma.user.update({
            where: { id },
            data: { name, username, role, phone, address, status },
            select: { id: true, name: true, username: true, role: true, phone: true, address: true, status: true, updatedAt: true },
        });
        res.json(user);
    } catch {
        res.status(500).json({ error: "Failed to update user" });
    }
};

export const resetUserPassword = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        res.status(400).json({ error: "newPassword must be at least 6 characters" });
        return;
    }
    try {
        const hash = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({ where: { id }, data: { password: hash } });
        res.json({ message: "Password reset successfully" });
    } catch {
        res.status(500).json({ error: "Failed to reset password" });
    }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    if (req.user?.id === id) {
        res.status(400).json({ error: "Cannot delete your own account" });
        return;
    }
    try {
        await prisma.user.delete({ where: { id } });
        res.json({ message: "User deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete user" });
    }
};
