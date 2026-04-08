/**
 * auto-updater.ts
 *
 * On startup (when running as a compiled .exe via `pkg`), this module:
 *   1. Checks internet connectivity.
 *   2. Fetches a version manifest from UPDATE_CHECK_URL.
 *   3. Compares the remote version with the embedded APP_VERSION.
 *   4. If a newer version is available, downloads the new .exe next to the
 *      current one, then launches an updater batch script that swaps the files
 *      and re-starts the application.
 *
 * The manifest must be a JSON file served at UPDATE_CHECK_URL with shape:
 *   {
 *     "version": "1.2.0",
 *     "url": "https://example.com/releases/cold-storage-1.2.0.exe",
 *     "notes": "What changed in this release (optional)"
 *   }
 *
 * Set UPDATE_CHECK_URL in .env to enable updates.
 * Leave it empty (or unset) to disable the update check silently.
 */

import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { execFile, spawn } from "child_process";
import { APP_VERSION } from "../version";

interface VersionManifest {
    version: string;
    url: string;
    notes?: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Compare two semver strings. Returns true when `remote` is newer than `local`. */
function isNewer(local: string, remote: string): boolean {
    const parse = (v: string) =>
        v
            .replace(/^v/, "")
            .split(".")
            .map((n) => parseInt(n, 10) || 0);

    const [lMaj, lMin, lPat] = parse(local);
    const [rMaj, rMin, rPat] = parse(remote);

    if (rMaj !== lMaj) return rMaj > lMaj;
    if (rMin !== lMin) return rMin > lMin;
    return rPat > lPat;
}

/** Fetch a URL and return the response body as a string. */
function fetchText(url: string, timeoutMs = 8000): Promise<string> {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith("https://") ? https : http;
        const req = mod.get(url, { timeout: timeoutMs }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode ?? "unknown"} for ${url}`));
                return;
            }
            let body = "";
            res.on("data", (chunk: Buffer) => (body += chunk.toString()));
            res.on("end", () => resolve(body));
        });
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Request timed out"));
        });
        req.on("error", reject);
    });
}

/** Stream a binary file from `url` into `destPath`. */
function downloadFile(
    url: string,
    destPath: string,
    onProgress?: (pct: number) => void
): Promise<void> {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith("https://") ? https : http;
        const file = fs.createWriteStream(destPath);

        mod.get(url, (res) => {
            if (res.statusCode !== 200) {
                file.close();
                fs.unlink(destPath, () => undefined);
                reject(new Error(`HTTP ${res.statusCode ?? "unknown"} while downloading`));
                return;
            }

            const total = parseInt(res.headers["content-length"] ?? "0", 10);
            let received = 0;

            res.on("data", (chunk: Buffer) => {
                received += chunk.length;
                if (total > 0 && onProgress) {
                    onProgress(Math.floor((received / total) * 100));
                }
            });

            res.pipe(file);
            file.on("finish", () => file.close(() => resolve()));
            file.on("error", (err) => {
                fs.unlink(destPath, () => undefined);
                reject(err);
            });
        }).on("error", (err) => {
            file.close();
            fs.unlink(destPath, () => undefined);
            reject(err);
        });
    });
}

/**
 * Write a temporary .bat file that:
 *   1. Waits until the running exe releases its lock.
 *   2. Replaces it with the downloaded copy.
 *   3. Re-launches the application.
 *   4. Deletes itself.
 */
function writeBatUpdater(
    currentExe: string,
    newExe: string,
    updaterBat: string
): void {
    // Escape paths for batch
    const esc = (p: string) => `"${p}"`;

    const script = [
        "@echo off",
        "echo Applying update, please wait...",
        // Give the running process time to shut down
        "timeout /t 3 /nobreak > nul",
        // Retry loop: wait until we can delete the old exe (it may still be locked)
        ":retry",
        `del /f /q ${esc(currentExe)} 2>nul`,
        `if exist ${esc(currentExe)} (`,
        "  timeout /t 2 /nobreak > nul",
        "  goto :retry",
        ")",
        // Move new exe into place
        `move /y ${esc(newExe)} ${esc(currentExe)}`,
        // Re-launch
        `start "" ${esc(currentExe)}`,
        // Clean up this script
        `del /f /q ${esc(updaterBat)}`,
    ].join("\r\n");

    fs.writeFileSync(updaterBat, script, "utf8");
}

// ─── main export ────────────────────────────────────────────────────────────

/**
 * Call this once on startup (before `app.listen`).
 * It resolves immediately if no update is needed or if the check fails for any reason.
 * On finding a newer version it downloads the update, spawns the bat updater,
 * and calls `process.exit(0)` so the bat can swap files.
 */
export async function checkForUpdates(): Promise<void> {
    const checkUrl = process.env.UPDATE_CHECK_URL?.trim();

    // Only run when packaged as an exe and a check URL is configured
    const isPackaged = Boolean(
        (process as NodeJS.Process & { pkg?: unknown }).pkg
    );

    if (!isPackaged) {
        console.log("[updater] Skipping update check (not running as .exe)");
        return;
    }

    if (!checkUrl) {
        // Silently skip — operator has not configured updates
        return;
    }

    console.log("[updater] Checking for updates...");

    let manifest: VersionManifest;

    try {
        const raw = await fetchText(checkUrl);
        manifest = JSON.parse(raw) as VersionManifest;

        if (!manifest.version || !manifest.url) {
            throw new Error("Invalid manifest: missing version or url");
        }
    } catch (err) {
        // Network error, malformed JSON, etc. — soft fail, just keep running
        console.warn(
            `[updater] Update check failed (will retry next startup): ${(err as Error).message
            }`
        );
        return;
    }

    if (!isNewer(APP_VERSION, manifest.version)) {
        console.log(
            `[updater] Up to date (${APP_VERSION}). No update available.`
        );
        return;
    }

    console.log(
        `[updater] New version available: ${manifest.version} (current: ${APP_VERSION})`
    );
    if (manifest.notes) {
        console.log(`[updater] Release notes: ${manifest.notes}`);
    }

    const currentExe = process.execPath;
    const exeDir = path.dirname(currentExe);
    const exeName = path.basename(currentExe, ".exe");
    const newExePath = path.join(exeDir, `${exeName}-update.exe`);
    const updaterBat = path.join(exeDir, `_updater-${Date.now()}.bat`);

    console.log("[updater] Downloading update...");

    let lastPct = -1;
    try {
        await downloadFile(manifest.url, newExePath, (pct) => {
            if (pct - lastPct >= 10) {
                console.log(`[updater] Download progress: ${pct}%`);
                lastPct = pct;
            }
        });
    } catch (err) {
        console.error(
            `[updater] Download failed: ${(err as Error).message}. Continuing with current version.`
        );
        // Clean up partial download
        try {
            if (fs.existsSync(newExePath)) fs.unlinkSync(newExePath);
        } catch {
            // ignore
        }
        return;
    }

    console.log("[updater] Download complete. Preparing to apply update...");

    writeBatUpdater(currentExe, newExePath, updaterBat);

    // Spawn the bat detached so it survives after this process exits
    const child = spawn("cmd.exe", ["/c", updaterBat], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
    });
    child.unref();

    console.log(
        "[updater] Update installer launched. The application will restart automatically."
    );

    // Give the log a moment to flush before exiting
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    process.exit(0);
}
