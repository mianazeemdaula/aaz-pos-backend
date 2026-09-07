import { Router } from "express";
import { register, login, changePassword, getMe } from "../controllers/authController";
import { authenticate } from "../middleware/auth";
import { bootstrapOrAuthorize } from "../services/auth";
import { prisma } from "../prisma/prisma";

const router = Router();

// Registration used to be wide open: anyone who could reach the server could
// POST themselves an ADMIN account. It is now the Users module, with one
// exception — a brand new install with no accounts yet needs a way to create
// the first one.
router.post(
    "/register",
    bootstrapOrAuthorize(() => prisma.user.count(), authenticate, "users", "edit"),
    register
);
router.post("/login", login);
router.post("/change-password", authenticate, changePassword);
router.get("/me", authenticate, getMe);

export default router;
