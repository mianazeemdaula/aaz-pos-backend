import { Router } from "express";
import multer from "multer";
import {
    getSettings, updateSettings, backupDatabase, restoreDatabase,
    getAppSettings, updateAppSettings,
    getUserSettings, updateUserSettings, getAllUsersSettings,
    uploadLogo, getLogo,
} from "../controllers/settings.controller";

const router = Router();

const logoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith("image/")) cb(null, true);
        else cb(new Error("Only image files are allowed"));
    },
});

router.get("/", getSettings);
router.put("/", updateSettings);
router.get("/backup", backupDatabase);
router.post("/restore", restoreDatabase);

// Logo
router.post("/logo", logoUpload.single("logo"), uploadLogo);
router.get("/logo", getLogo);

// App settings (DB-stored)
router.get("/app", getAppSettings);
router.put("/app", updateAppSettings);

// Per-user settings
router.get("/users", getAllUsersSettings);
router.get("/users/:userId", getUserSettings);
router.put("/users/:userId", updateUserSettings);

export default router;
