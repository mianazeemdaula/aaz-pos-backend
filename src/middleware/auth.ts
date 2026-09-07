import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "change-me";

/** Verifies the bearer token and puts the caller on `req.user`. */
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

// Authorisation lives in services/auth. The role on `req.user` comes from a
// token that lasts a week, so a guard must re-read it from the database —
// which is what `requireRole` there does, unlike the version that used to sit
// here and trusted the token.
export { requireRole, authorize } from "../services/auth";
