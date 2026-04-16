import { Router } from "express";
import {
    getSettings, updateSettings, backupDatabase, restoreDatabase,
    getAppSettings, updateAppSettings,
    getUserSettings, updateUserSettings, getAllUsersSettings,
} from "../controllers/settings.controller";

const router = Router();

router.get("/", getSettings);
router.put("/", updateSettings);
router.get("/backup", backupDatabase);
router.post("/restore", restoreDatabase);

// App settings (DB-stored)
router.get("/app", getAppSettings);
router.put("/app", updateAppSettings);

// Per-user settings
router.get("/users", getAllUsersSettings);
router.get("/users/:userId", getUserSettings);
router.put("/users/:userId", updateUserSettings);

export default router;
