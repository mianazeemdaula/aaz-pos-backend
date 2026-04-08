import { Router } from "express";
import { register, login, changePassword, getMe } from "../controllers/authController";
import { authenticate } from "../middleware/auth";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/change-password", authenticate, changePassword);
router.get("/me", authenticate, getMe);

export default router;
