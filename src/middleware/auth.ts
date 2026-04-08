import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "change-me";

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number; username: string; role: string };
    req.user = { id: payload.sub, username: payload.username, role: payload.role };
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

export const requireRole = (...roles: string[]) => (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user || !roles.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
};
