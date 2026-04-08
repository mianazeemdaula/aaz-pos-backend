import { Router } from "express";
import { getSettings, updateSettings, backupDatabase, restoreDatabase } from "../controllers/settings.controller";

const router = Router();

router.get("/", getSettings);
router.put("/", updateSettings);
router.get("/backup", backupDatabase);
router.post("/restore", restoreDatabase);

export default router;
