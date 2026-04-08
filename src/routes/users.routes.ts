import { Router } from "express";
import { listUsers, getUser, createUser, updateUser, deleteUser, resetUserPassword } from "../controllers/users.controller";

const router = Router();

router.get("/", listUsers);
router.get("/:id", getUser);
router.post("/", createUser);
router.put("/:id", updateUser);
router.post("/:id/reset-password", resetUserPassword);
router.delete("/:id", deleteUser);

export default router;
