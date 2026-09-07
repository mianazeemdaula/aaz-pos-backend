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
import { authorize, allowSelfOr } from "../services/auth";

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

/**
 * Settings guards itself, because a single rule would be wrong for it.
 *
 * Everything a client must read merely to finish signing in is listed FIRST and
 * left open to any authenticated user. Immediately after comes a blanket
 * `authorize("settings")`, so every route below it — and every route anyone
 * adds later — needs the Settings module by default. Adding an exception has to
 * be a deliberate move above the line.
 */

// ─── Readable by any signed-in user ────────────────────────────────────────
// Branding, currency and tax defaults that the till and the receipt render from.
router.get("/", getSettings);
router.get("/logo", getLogo);
router.get("/app", getAppSettings);
// Your own settings hold your own permissions — the client cannot start without
// them. Reading anybody else's is an administrative act.
router.get("/users/:userId", allowSelfOr("settings", "view", "userId"), getUserSettings);

// ─── Everything below is the Settings module ───────────────────────────────
router.use(authorize("settings"));

router.put("/", updateSettings);
router.put("/app", updateAppSettings);
router.post("/logo", logoUpload.single("logo"), uploadLogo);
router.delete("/logo", deleteLogo);

// Backup and restore move the whole database.
router.get("/backup", backupDatabase);
router.get("/backup/status", getBackupStatus);
router.get("/backup/json", backupDatabaseJson);
router.get("/backup/browse", browseDirectories);
router.post("/backup/run", runDirectoryBackup);
router.post("/backup/validate-dir", validateBackupDir);
router.post("/restore", backupUpload.single("backup"), restoreDatabase);

// A cashier who could PUT here would simply grant themselves every permission.
router.get("/users", getAllUsersSettings);
router.put("/users/:userId", updateUserSettings);

export default router;
