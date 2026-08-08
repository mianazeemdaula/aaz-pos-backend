import path from "path";
import os from "os";
import { Worker } from "worker_threads";
import { ReportSpec } from "./report-spec";
import type { RenderResponse } from "./pdf-worker";

/**
 * A tiny, lazily-spawned pool of PDF rendering threads.
 *
 * Design goals, in order:
 *   1. Never block the Express event loop with report layout.
 *   2. Cost nothing when no one is running reports — threads are spawned on
 *      the first job and retired again once they have been idle for a while.
 *   3. Never fail a report because threading is unavailable. Any spawn or
 *      transport problem permanently downgrades to in-process rendering, which
 *      is the exact behaviour the app had before.
 */

const DEFAULT_MAX_WORKERS = Math.max(1, Math.min(2, (os.cpus()?.length || 2) - 1));
const MAX_WORKERS = clampInt(process.env.PDF_WORKERS, DEFAULT_MAX_WORKERS, 0, 8);
const IDLE_TIMEOUT_MS = clampInt(process.env.PDF_WORKER_IDLE_MS, 60000, 5000, 600000);
const JOB_TIMEOUT_MS = clampInt(process.env.PDF_JOB_TIMEOUT_MS, 120000, 5000, 600000);

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
    const parsed = raw != null && raw !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

/**
 * Reason a render did not come back from a thread. Both are recoverable by
 * rendering in-process; a genuine layout error is *not* and propagates as-is.
 */
export type PoolFailure = "THREADING_UNAVAILABLE" | "WORKER_FAILED";

export function poolFailureOf(error: unknown): PoolFailure | undefined {
    const code = (error as { poolFailure?: PoolFailure } | null)?.poolFailure;
    return code;
}

function poolError(code: PoolFailure, message?: string): Error {
    const error = new Error(message || code) as Error & { poolFailure: PoolFailure };
    error.poolFailure = code;
    return error;
}

interface Job {
    id: number;
    spec: ReportSpec;
    resolve: (buffer: Buffer) => void;
    reject: (error: Error) => void;
}

interface PoolWorker {
    worker: Worker;
    /** Job currently being rendered by this thread, if any. */
    job: Job | null;
    timer: NodeJS.Timeout | null;
    idleTimer: NodeJS.Timeout | null;
}

const workers: PoolWorker[] = [];
const queue: Job[] = [];
let nextJobId = 1;
/** Set once threading proves unavailable; from then on we render in-process. */
let threadingDisabled = MAX_WORKERS === 0;
let warnedAboutFallback = false;

function workerEntryPath(): string {
    // In development this module is `.../src/utils/pdf/pdf-worker-pool.ts`; in a
    // build (or inside the packaged exe) it is the compiled `.js` next to it.
    return path.join(__dirname, "pdf-worker" + (path.extname(__filename) || ".js"));
}

function spawnWorker(): PoolWorker | null {
    const entry = workerEntryPath();
    try {
        // A TypeScript entry only happens under ts-node/ts-node-dev, where the
        // worker needs the same compiler hook installed before it can require
        // the renderer. Compiled builds load the file directly, which is also
        // what the pkg snapshot loader understands.
        const bootstrap =
            "require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });" +
            "require(" + JSON.stringify(entry) + ");";

        const worker = entry.endsWith(".ts")
            ? new Worker(bootstrap, { eval: true })
            : new Worker(entry);

        const poolWorker: PoolWorker = { worker, job: null, timer: null, idleTimer: null };

        worker.on("message", (message: RenderResponse) => onMessage(poolWorker, message));
        worker.on("error", (error) => failWorker(poolWorker, error));
        worker.on("exit", (code) => {
            if (poolWorker.job) {
                failWorker(poolWorker, new Error("PDF worker exited with code " + code));
            } else {
                removeWorker(poolWorker);
            }
        });
        // An idle thread must never hold the process open. It is re-`ref`d for
        // the duration of each job so a render in flight always finishes.
        worker.unref();

        workers.push(poolWorker);
        return poolWorker;
    } catch (error) {
        disableThreading(error);
        return null;
    }
}

function disableThreading(error: unknown): void {
    threadingDisabled = true;
    if (!warnedAboutFallback) {
        warnedAboutFallback = true;
        console.warn(
            "[pdf] worker threads unavailable, falling back to in-process rendering:",
            error instanceof Error ? error.message : error
        );
    }
}

function removeWorker(entry: PoolWorker): void {
    const index = workers.indexOf(entry);
    if (index >= 0) workers.splice(index, 1);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (entry.timer) clearTimeout(entry.timer);
    entry.idleTimer = null;
    entry.timer = null;
}

function failWorker(entry: PoolWorker, error: Error): void {
    const job = entry.job;
    entry.job = null;
    removeWorker(entry);
    entry.worker.terminate().catch(() => undefined);

    // The thread died or stalled; the report itself may be perfectly fine, so
    // the caller is told this is a threading failure and can render in-process.
    if (job) job.reject(poolError("WORKER_FAILED", error.message));
    pump();
}

function onMessage(entry: PoolWorker, message: RenderResponse): void {
    const job = entry.job;
    if (!job || job.id !== message.id) return;

    entry.job = null;
    if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
    }
    entry.worker.unref();

    if (message.ok) {
        job.resolve(Buffer.from(message.buffer));
    } else {
        job.reject(new Error(message.error));
    }

    scheduleIdleShutdown(entry);
    pump();
}

/** Retire a thread that has had nothing to do, so idle memory goes back. */
function scheduleIdleShutdown(entry: PoolWorker): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
        if (entry.job) return;
        removeWorker(entry);
        entry.worker.terminate().catch(() => undefined);
    }, IDLE_TIMEOUT_MS);
    entry.idleTimer.unref?.();
}

function assign(entry: PoolWorker, job: Job): void {
    entry.job = job;
    if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
    }
    entry.timer = setTimeout(() => {
        failWorker(entry, new Error("PDF rendering timed out"));
    }, JOB_TIMEOUT_MS);
    entry.timer.unref?.();
    // Keep the event loop alive until this render comes back.
    entry.worker.ref();

    try {
        entry.worker.postMessage({ id: job.id, spec: job.spec });
    } catch (error) {
        failWorker(entry, error instanceof Error ? error : new Error(String(error)));
    }
}

/** Reject everything still waiting, so no caller is left hanging. */
function drainQueue(): void {
    while (queue.length > 0) {
        queue.shift()!.reject(poolError("THREADING_UNAVAILABLE"));
    }
}

function pump(): void {
    while (queue.length > 0) {
        const idle = workers.find((entry) => !entry.job);
        if (idle) {
            assign(idle, queue.shift()!);
            continue;
        }
        if (workers.length < MAX_WORKERS) {
            const spawned = spawnWorker();
            if (!spawned) {
                // Threading just proved unavailable. Hand every waiting job
                // back so it can be rendered in-process instead of hanging.
                drainQueue();
                return;
            }
            assign(spawned, queue.shift()!);
            continue;
        }
        return; // All threads busy; the queue drains as they report back.
    }
}

/** True when reports are currently being rendered off the main thread. */
export function isThreadedRenderingEnabled(): boolean {
    return !threadingDisabled;
}

/** Number of live rendering threads (diagnostics / health endpoint). */
export function getPoolSize(): number {
    return workers.length;
}

/**
 * Render on a worker thread. Rejects with `THREADING_UNAVAILABLE` when the
 * pool cannot be used at all, which the caller turns into inline rendering.
 */
export function renderOnWorker(spec: ReportSpec): Promise<Buffer> {
    if (threadingDisabled) {
        return Promise.reject(poolError("THREADING_UNAVAILABLE"));
    }
    return new Promise<Buffer>((resolve, reject) => {
        const job: Job = { id: nextJobId++, spec, resolve, reject };
        queue.push(job);
        pump();

        // `pump` may have discovered that this runtime cannot spawn threads at
        // all, in which case it has already drained the queue.
        if (threadingDisabled && queue.indexOf(job) >= 0) {
            queue.splice(queue.indexOf(job), 1);
            reject(poolError("THREADING_UNAVAILABLE"));
        }
    });
}

/** Pre-spawn one thread so the first report of the day is not the slow one. */
export function warmUpPdfWorkers(): void {
    if (threadingDisabled || workers.length > 0 || MAX_WORKERS === 0) return;
    const entry = spawnWorker();
    if (entry) scheduleIdleShutdown(entry);
}

/** Tear the pool down (graceful shutdown). */
export async function shutdownPdfWorkers(): Promise<void> {
    const live = workers.splice(0, workers.length);
    await Promise.all(
        live.map((entry) => {
            if (entry.idleTimer) clearTimeout(entry.idleTimer);
            if (entry.timer) clearTimeout(entry.timer);
            return entry.worker.terminate().catch(() => undefined);
        })
    );
}
