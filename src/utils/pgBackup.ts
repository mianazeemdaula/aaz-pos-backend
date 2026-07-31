/**
 * Native PostgreSQL backup/restore helpers.
 *
 * Backups are produced by `pg_dump` so the resulting file is a real Postgres
 * artifact — restorable with `pg_restore`/`psql` on any machine, independent of
 * this application. Two formats are supported:
 *
 *   custom (.dump) — compressed pg_dump archive, restored with pg_restore
 *   plain  (.sql)  — SQL script with DROP statements, restored with psql
 */

import { spawn, execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export type DumpFormat = "custom" | "plain";
export type PgTool = "pg_dump" | "pg_restore" | "psql";

export interface PgConnection {
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
}

/** Magic header of a pg_dump custom/tar archive. */
const PGDMP_MAGIC = "PGDMP";

export class PgToolError extends Error {}

// ─── Connection ──────────────────────────────────────────────────────────────

export function parseDatabaseUrl(url = process.env.DATABASE_URL): PgConnection {
    if (!url) throw new PgToolError("DATABASE_URL is not configured");

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new PgToolError("DATABASE_URL is not a valid connection string");
    }

    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    if (!database) throw new PgToolError("DATABASE_URL does not name a database");

    return {
        host: parsed.hostname || "localhost",
        port: parsed.port || "5432",
        user: decodeURIComponent(parsed.username) || "postgres",
        password: decodeURIComponent(parsed.password),
        database,
    };
}

// ─── Tool discovery ──────────────────────────────────────────────────────────

const isWindows = process.platform === "win32";
const exe = (tool: PgTool) => (isWindows ? `${tool}.exe` : tool);

/**
 * Installation directories recorded by the Windows PostgreSQL installer.
 * This is what finds installs outside Program Files.
 */
function windowsRegistryDirs(): string[] {
    try {
        const output = execFileSync(
            "reg",
            ["query", "HKLM\\SOFTWARE\\PostgreSQL\\Installations", "/s"],
            { encoding: "utf8", windowsHide: true, timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
        );
        const dirs = [...output.matchAll(/Base Directory\s+REG_SZ\s+(.+)/g)]
            .map(match => path.join(match[1].trim(), "bin"));
        return dirs.reverse(); // keys are listed oldest-first; prefer the newest install
    } catch {
        return []; // no installer registry entry — fall through to the path scan
    }
}

/** Candidate directories holding the Postgres client binaries, best first. */
function candidateDirs(): string[] {
    const dirs: string[] = [];

    // Explicit override always wins.
    if (process.env.PG_BIN_DIR) dirs.push(process.env.PG_BIN_DIR);

    if (isWindows) {
        dirs.push(...windowsRegistryDirs());
        for (const root of ["C:\\Program Files\\PostgreSQL", "C:\\Program Files (x86)\\PostgreSQL"]) {
            try {
                const versions = fs
                    .readdirSync(root)
                    .filter(name => /^\d+/.test(name))
                    .sort((a, b) => parseInt(b, 10) - parseInt(a, 10)); // newest first
                for (const version of versions) dirs.push(path.join(root, version, "bin"));
            } catch {
                /* root not present */
            }
        }
    } else {
        dirs.push("/usr/bin", "/usr/local/bin", "/opt/homebrew/bin", "/opt/homebrew/opt/libpq/bin");
        try {
            const root = "/usr/lib/postgresql";
            const versions = fs
                .readdirSync(root)
                .sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
            for (const version of versions) dirs.push(path.join(root, version, "bin"));
        } catch {
            /* not a Debian-style install */
        }
    }

    return dirs;
}

const toolCache = new Map<PgTool, string>();

/**
 * Absolute path to a Postgres client binary.
 * Looks at PG_BIN_DIR, then well-known install locations, then PATH.
 */
export function resolvePgTool(tool: PgTool): string {
    const cached = toolCache.get(tool);
    if (cached) return cached;

    for (const dir of candidateDirs()) {
        const candidate = path.join(dir, exe(tool));
        if (fs.existsSync(candidate)) {
            toolCache.set(tool, candidate);
            return candidate;
        }
    }

    // Fall back to PATH resolution — spawn will fail with ENOENT if absent.
    const onPath = exe(tool);
    toolCache.set(tool, onPath);
    return onPath;
}

interface RunResult {
    stdout: string;
    stderr: string;
}

/** Run a Postgres client binary, rejecting with its stderr on failure. */
function run(tool: PgTool, args: string[], password?: string): Promise<RunResult> {
    const binary = resolvePgTool(tool);

    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, {
            env: {
                ...process.env,
                ...(password ? { PGPASSWORD: password } : {}),
                // Keep stderr parseable regardless of the host locale.
                LC_MESSAGES: "C",
            },
            windowsHide: true,
        });

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", chunk => { stdout += chunk.toString(); });
        child.stderr.on("data", chunk => { stderr += chunk.toString(); });

        child.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "ENOENT") {
                reject(new PgToolError(
                    `${tool} was not found. Install the PostgreSQL client tools, ` +
                    `or set PG_BIN_DIR to the folder containing ${exe(tool)}.`,
                ));
            } else {
                reject(new PgToolError(`${tool} failed to start: ${err.message}`));
            }
        });

        child.on("close", code => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(new PgToolError(stderr.trim() || `${tool} exited with code ${code}`));
        });
    });
}

/** Version banner of a tool, e.g. "pg_dump (PostgreSQL) 16.2". */
export async function pgToolVersion(tool: PgTool): Promise<string> {
    const { stdout } = await run(tool, ["--version"]);
    return stdout.trim();
}

// ─── Backup ──────────────────────────────────────────────────────────────────

const connectionArgs = (conn: PgConnection) => [
    "-h", conn.host,
    "-p", conn.port,
    "-U", conn.user,
    "-d", conn.database,
];

export interface DumpResult {
    /** Written dump. For temp dumps the caller is responsible for deleting it. */
    filePath: string;
    filename: string;
    bytes: number;
}

/** Filenames this module creates — the only ones retention is ever allowed to delete. */
const BACKUP_FILE_PATTERN = /^pos-backup-[\d-]+\.(dump|sql)$/;

/**
 * Timestamped backup name, to the second.
 * Two backups in the same second get a counter suffix rather than silently
 * overwriting each other.
 */
export function backupFilename(format: DumpFormat, destDir?: string, at = new Date()): string {
    const extension = format === "custom" ? "dump" : "sql";
    const stamp = at.toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const base = `pos-backup-${stamp}`;

    if (!destDir) return `${base}.${extension}`;

    let name = `${base}.${extension}`;
    for (let n = 2; fs.existsSync(path.join(destDir, name)); n++) {
        name = `${base}-${n}.${extension}`;
    }
    return name;
}

/**
 * Dump the database to a file.
 *
 * Without `destDir` the dump lands in a temp file — writing to a file rather
 * than streaming straight to the client means a failure is reported as an error
 * instead of arriving as a truncated download. With `destDir` pg_dump writes
 * directly into the backup folder, with no copy in between.
 */
export async function dumpDatabase(format: DumpFormat = "custom", destDir?: string): Promise<DumpResult> {
    const conn = parseDatabaseUrl();
    const extension = format === "custom" ? "dump" : "sql";
    const filename = backupFilename(format, destDir);
    const filePath = destDir
        ? path.join(destDir, filename)
        : path.join(os.tmpdir(), `pos-dump-${process.pid}-${Date.now()}.${extension}`);

    const args = [
        ...connectionArgs(conn),
        "--no-owner",
        "--no-privileges",
        "--encoding=UTF8",
        "--file", filePath,
    ];

    if (format === "custom") {
        args.push("--format=custom", "--compress=6");
    } else {
        // Plain SQL has to carry its own DROP statements to be restorable
        // over an existing database.
        args.push("--format=plain", "--clean", "--if-exists");
    }

    try {
        await run("pg_dump", args, conn.password);
    } catch (error) {
        await fs.promises.rm(filePath, { force: true });
        throw error;
    }

    const { size } = await fs.promises.stat(filePath);
    if (size === 0) {
        await fs.promises.rm(filePath, { force: true });
        throw new PgToolError("pg_dump produced an empty file");
    }

    return { filePath, filename, bytes: size };
}

// ─── Scheduled backups to a folder ───────────────────────────────────────────

export interface DirectoryEntry {
    name: string;
    path: string;
}

export interface DirectoryListing {
    /** Empty string means "the roots" — drive letters on Windows. */
    path: string;
    parent: string | null;
    writable: boolean;
    entries: DirectoryEntry[];
}

/** Drive roots on Windows, filesystem root and home elsewhere. */
function rootEntries(): DirectoryEntry[] {
    if (!isWindows) {
        return [
            { name: "/", path: "/" },
            { name: `~ (${path.basename(os.homedir())})`, path: os.homedir() },
        ];
    }
    const drives: DirectoryEntry[] = [];
    for (let code = "A".charCodeAt(0); code <= "Z".charCodeAt(0); code++) {
        const letter = String.fromCharCode(code);
        const root = `${letter}:\\`;
        try {
            if (fs.existsSync(root)) drives.push({ name: `${letter}:`, path: root });
        } catch {
            /* drive not ready (empty card reader etc.) */
        }
    }
    return drives;
}

/** True when a new file can actually be created in `dir`. */
export async function isWritable(dir: string): Promise<boolean> {
    const probe = path.join(dir, `.pos-write-test-${process.pid}`);
    try {
        await fs.promises.writeFile(probe, "");
        await fs.promises.rm(probe, { force: true });
        return true;
    } catch {
        return false;
    }
}

/**
 * List sub-directories of `target`, for the folder picker.
 * An empty or missing `target` lists the drive roots.
 */
export async function listDirectories(target?: string): Promise<DirectoryListing> {
    if (!target) {
        return { path: "", parent: null, writable: false, entries: rootEntries() };
    }

    const resolved = path.resolve(target);
    const dirents = await fs.promises.readdir(resolved, { withFileTypes: true });

    const entries: DirectoryEntry[] = [];
    for (const dirent of dirents) {
        if (!dirent.isDirectory()) continue;
        // Hide dotfolders and the Windows system folders that clutter drive roots.
        if (dirent.name.startsWith(".") || dirent.name.startsWith("$")) continue;
        if (dirent.name === "System Volume Information") continue;
        entries.push({ name: dirent.name, path: path.join(resolved, dirent.name) });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    const parentPath = path.dirname(resolved);
    return {
        path: resolved,
        // At a drive root dirname() returns the root itself — step out to the root list.
        parent: parentPath === resolved ? "" : parentPath,
        writable: await isWritable(resolved),
        entries,
    };
}

/** Create `dir` if needed and confirm backups can be written into it. */
export async function ensureBackupDir(dir: string): Promise<string> {
    const resolved = path.resolve(dir);
    try {
        await fs.promises.mkdir(resolved, { recursive: true });
    } catch (error) {
        throw new PgToolError(
            `Cannot create backup folder "${resolved}": ${error instanceof Error ? error.message : "unknown error"}`,
        );
    }
    if (!(await isWritable(resolved))) {
        throw new PgToolError(`Backup folder "${resolved}" is not writable`);
    }
    return resolved;
}

/**
 * Delete the oldest backups beyond `keep`.
 * Only files this module created are ever considered — anything else the user
 * keeps in the folder is left alone.
 */
export async function applyRetention(dir: string, keep: number): Promise<string[]> {
    if (!Number.isFinite(keep) || keep <= 0) return [];

    const names = (await fs.promises.readdir(dir)).filter(name => BACKUP_FILE_PATTERN.test(name));
    if (names.length <= keep) return [];

    const stated = await Promise.all(names.map(async name => {
        const full = path.join(dir, name);
        const { mtimeMs } = await fs.promises.stat(full);
        return { name, full, mtimeMs };
    }));
    stated.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first

    const removed: string[] = [];
    for (const file of stated.slice(keep)) {
        try {
            await fs.promises.rm(file.full, { force: true });
            removed.push(file.name);
        } catch {
            /* leave it — a locked file must not fail the backup */
        }
    }
    return removed;
}

export interface ScheduledBackupResult {
    filePath: string;
    filename: string;
    bytes: number;
    removed: string[];
}

/** Dump straight into the configured folder and prune old backups. */
export async function backupToDirectory(
    dir: string,
    format: DumpFormat = "custom",
    keep = 30,
): Promise<ScheduledBackupResult> {
    const resolved = await ensureBackupDir(dir);
    const dump = await dumpDatabase(format, resolved);
    const removed = await applyRetention(resolved, keep);
    return { filePath: dump.filePath, filename: dump.filename, bytes: dump.bytes, removed };
}

/** Most recent backup already present in the folder, if any. */
export async function latestBackup(dir: string): Promise<{ filename: string; bytes: number; at: string } | null> {
    let names: string[];
    try {
        names = (await fs.promises.readdir(dir)).filter(name => BACKUP_FILE_PATTERN.test(name));
    } catch {
        return null;
    }
    if (names.length === 0) return null;

    const stated = await Promise.all(names.map(async name => {
        const { mtimeMs, size } = await fs.promises.stat(path.join(dir, name));
        return { name, mtimeMs, size };
    }));
    stated.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const newest = stated[0];
    return { filename: newest.name, bytes: newest.size, at: new Date(newest.mtimeMs).toISOString() };
}

// ─── Restore ─────────────────────────────────────────────────────────────────

export type BackupKind = "custom" | "plain" | "json" | "unknown";

/** Identify a backup file from its first bytes. */
export async function detectBackupKind(filePath: string): Promise<BackupKind> {
    const handle = await fs.promises.open(filePath, "r");
    try {
        const buffer = Buffer.alloc(512);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const head = buffer.subarray(0, bytesRead);

        if (head.subarray(0, 5).toString("latin1") === PGDMP_MAGIC) return "custom";

        const text = head.toString("utf8").trimStart();
        if (text.startsWith("{")) return "json";
        // pg_dump plain output always opens with its comment banner or SET lines.
        if (/^(--|SET |BEGIN;|DROP |CREATE |ALTER |COPY )/i.test(text)) return "plain";
        return "unknown";
    } finally {
        await handle.close();
    }
}

/**
 * Restore a pg_dump archive over the current database.
 * Existing objects are dropped first, and the whole restore runs in one
 * transaction so a failure leaves the database untouched.
 */
export async function restoreDump(filePath: string, kind: "custom" | "plain"): Promise<string> {
    const conn = parseDatabaseUrl();

    if (kind === "custom") {
        const { stderr } = await run("pg_restore", [
            ...connectionArgs(conn),
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-privileges",
            "--single-transaction",
            filePath,
        ], conn.password);
        return stderr.trim();
    }

    const { stderr } = await run("psql", [
        ...connectionArgs(conn),
        "--quiet",
        "--single-transaction",
        "-v", "ON_ERROR_STOP=1",
        "-f", filePath,
    ], conn.password);
    return stderr.trim();
}

// ─── Availability probe ──────────────────────────────────────────────────────

export interface BackupStatus {
    available: boolean;
    database?: string;
    host?: string;
    pgDump?: string;
    pgRestore?: string;
    error?: string;
}

/** Whether native backups can run here — used to explain the situation up front. */
export async function backupStatus(): Promise<BackupStatus> {
    try {
        const conn = parseDatabaseUrl();
        const [pgDump, pgRestore] = await Promise.all([
            pgToolVersion("pg_dump"),
            pgToolVersion("pg_restore"),
        ]);
        return {
            available: true,
            database: conn.database,
            host: `${conn.host}:${conn.port}`,
            pgDump,
            pgRestore,
        };
    } catch (error) {
        return {
            available: false,
            error: error instanceof Error ? error.message : "Postgres client tools unavailable",
        };
    }
}
