import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";
import {
    ADMIN_ROLE,
    assertCanAssignRole,
    assertNoSelfEscalation,
    assertNotLastAdmin,
    assertNotSelfDelete,
    assertPasswordStrength,
    assertValidRole,
    invalidateAccessProfile,
    isAccessError,
    type Actor,
    type AdminCensus,
    type UserChanges,
} from "../services/auth";

const publicFields = {
    id: true, name: true, username: true, role: true,
    phone: true, address: true, status: true,
    createdAt: true, updatedAt: true, lastLogin: true,
} as const;

const actorOf = (req: Request): Actor => ({
    id: req.user?.id ?? -1,
    role: req.user?.role ?? "",
});

/** Count active admins and say whether the target is one, for the last-admin guard. */
async function adminCensus(targetUserId: number): Promise<AdminCensus> {
    const [activeAdmins, target] = await Promise.all([
        prisma.user.count({ where: { role: ADMIN_ROLE, status: true } }),
        prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true, status: true } }),
    ]);
    return {
        activeAdmins,
        targetIsActiveAdmin: target?.role === ADMIN_ROLE && target.status === true,
    };
}

const fail = (res: Response, err: unknown, fallback: string): void => {
    if (isAccessError(err)) {
        res.status(err.status).json({ error: err.message });
        return;
    }
    console.error(`${fallback}:`, err);
    res.status(500).json({ error: fallback });
};

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
                select: publicFields,
            }),
            prisma.user.count({ where }),
        ]);

        res.json(createPaginatedResponse(users, total, page, pageSize));
    } catch (err) {
        fail(res, err, "Failed to fetch users");
    }
};

export const getUser = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const user = await prisma.user.findUnique({ where: { id }, select: publicFields });
        if (!user) { res.status(404).json({ error: "User not found" }); return; }
        res.json(user);
    } catch (err) {
        fail(res, err, "Failed to fetch user");
    }
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
    const { name, username, password, role, phone, address, status } = req.body;
    if (!name || !username || !password || !role) {
        res.status(400).json({ error: "name, username, password and role are required" });
        return;
    }

    try {
        assertValidRole(role);
        assertPasswordStrength(password);
        // Holding `users.edit` lets you manage staff — it does not let you mint
        // an administrator.
        assertCanAssignRole(actorOf(req), role);

        const existing = await prisma.user.findUnique({ where: { username } });
        if (existing) { res.status(409).json({ error: "Username already taken" }); return; }

        const hash = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: {
                name,
                username,
                password: hash,
                role,
                phone,
                address,
                status: status !== undefined ? status : true,
            },
            select: publicFields,
        });
        res.status(201).json(user);
    } catch (err) {
        fail(res, err, "Failed to create user");
    }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { name, username, password, role, phone, address, status } = req.body;
    const changes: UserChanges = { role, status };

    try {
        if (role) assertValidRole(role);
        if (password) assertPasswordStrength(password);

        const actor = actorOf(req);
        assertCanAssignRole(actor, role);
        assertNoSelfEscalation(actor, id, changes);
        assertNotLastAdmin(await adminCensus(id), changes);

        if (username) {
            const existing = await prisma.user.findFirst({ where: { username, NOT: { id } } });
            if (existing) { res.status(409).json({ error: "Username already taken" }); return; }
        }

        const updateData: any = { name, username, role, phone, address, status };
        if (password) updateData.password = await bcrypt.hash(password, 10);

        const user = await prisma.user.update({
            where: { id },
            data: updateData,
            select: publicFields,
        });

        // A role or status change must take effect now, not when the cache expires.
        invalidateAccessProfile(id);
        res.json(user);
    } catch (err) {
        fail(res, err, "Failed to update user");
    }
};

export const resetUserPassword = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { newPassword } = req.body;
    try {
        assertPasswordStrength(newPassword, "newPassword");
        const hash = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({ where: { id }, data: { password: hash } });
        res.json({ message: "Password reset successfully" });
    } catch (err) {
        fail(res, err, "Failed to reset password");
    }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        assertNotSelfDelete(actorOf(req), id);
        assertNotLastAdmin(await adminCensus(id), { deleting: true });

        await prisma.user.delete({ where: { id } });
        invalidateAccessProfile(id);
        res.json({ message: "User deleted" });
    } catch (err) {
        fail(res, err, "Failed to delete user");
    }
};
