import { Router } from "express";
import multer from "multer";
import os from "os";
import {
    getSettings, updateSettings, backupDatabase, backupDatabaseJson,
    getBackupStatus, restoreDatabase,
    browseDirectories, runDirectoryBackup, validateBackupDir,
    getAppSettings, updateAppSettings,
    getUserSettings, updateUserSettings, getAllUsersSettings,
    uploadLogo, getLogo, deleteLogo,
} from "../controllers/settings.controller";

const router = Router();

// Backups go straight to disk — pg_restore reads a file, and a full database
// dump is far too large to hold in memory.
const backupUpload = multer({
    storage: multer.diskStorage({
        destination: os.tmpdir(),
        filename: (_req, _file, cb) => cb(null, `pos-restore-${Date.now()}.bak`),
    }),
    limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

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
router.get("/backup/status", getBackupStatus);
router.get("/backup/json", backupDatabaseJson);
router.get("/backup/browse", browseDirectories);
router.post("/backup/run", runDirectoryBackup);
router.post("/backup/validate-dir", validateBackupDir);
router.post("/restore", backupUpload.single("backup"), restoreDatabase);

// Logo
router.post("/logo", logoUpload.single("logo"), uploadLogo);
router.get("/logo", getLogo);
router.delete("/logo", deleteLogo);

// App settings (DB-stored)
router.get("/app", getAppSettings);
router.put("/app", updateAppSettings);

// Per-user settings
router.get("/users", getAllUsersSettings);
router.get("/users/:userId", getUserSettings);
router.put("/users/:userId", updateUserSettings);

export default router;
