import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma/prisma";
import {
  ADMIN_ROLE,
  assertCanAssignRole,
  assertValidRole,
  getAccessProfile,
  isAccessError,
} from "../services/auth";

const JWT_SECRET = process.env.JWT_SECRET || "change-me";

export const register = async (req: Request, res: Response): Promise<void> => {
  const { name, username, password, phone, address } = req.body;
  // On a blank install the very first account must be able to administer the
  // system, so it is created as an administrator whatever was asked for.
  const isBootstrap = (req as Request & { isBootstrap?: boolean }).isBootstrap === true;
  const role: string = isBootstrap ? ADMIN_ROLE : req.body.role;

  if (!name || !username || !password || !role) {
    res.status(400).json({ error: "name, username, password and role are required" });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: "password must be at least 6 characters" });
    return;
  }

  try {
    assertValidRole(role);
    if (!isBootstrap) {
      assertCanAssignRole({ id: req.user?.id ?? -1, role: req.user?.role ?? "" }, role);
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, username, password: hash, role, phone, address },
    });

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.status(201).json({
      token,
      user: { id: user.id, name: user.name, username: user.username, role: user.role, createdAt: user.createdAt },
    });
  } catch (error) {
    if (isAccessError(error)) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Registration failed:", error);
    res.status(500).json({ error: "Registration failed" });
  }
};

export const changePassword = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }

  if (newPassword.length < 6) {
    res.status(400).json({ error: "newPassword must be at least 6 characters" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: userId }, data: { password: hash } });

    res.json({ message: "Password changed successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to change password" });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "username and password required" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (!user.status) {
      res.status(403).json({ error: "Account is inactive" });
      return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" },
    );
    res.json({
      token,
      user: { id: user.id, name: user.name, username: user.username, role: user.role, lastLogin: new Date() },
    });
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, username: true, role: true, phone: true, address: true, status: true, createdAt: true, lastLogin: true },
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Ship the resolved permissions alongside the profile so the client does
    // not have to derive them itself and drift from what the API enforces.
    const profile = await getAccessProfile(userId);
    res.json({ ...user, permissions: profile?.permissions ?? null });
  } catch (error) {
    console.error("Failed to fetch profile:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
};
