import fs from "fs";
import { getReportFontTheme } from "./report-fonts";

/**
 * Binary assets used by every report (fonts, logo).
 *
 * The font files in this project total ~2.7 MB. Reading them from disk once
 * per PDF was pure waste: the bytes never change while the process is alive.
 * Everything here is read lazily and then held in a module-level cache — in
 * the worker thread that means the first report pays for the read and every
 * report after it is served from memory.
 */

const fileCache = new Map<string, Buffer | null>();

function readCached(filePath: string | undefined): Buffer | undefined {
    if (!filePath) return undefined;
    if (fileCache.has(filePath)) {
        return fileCache.get(filePath) || undefined;
    }
    let buffer: Buffer | null = null;
    try {
        buffer = fs.readFileSync(filePath);
    } catch {
        buffer = null;
    }
    fileCache.set(filePath, buffer);
    return buffer || undefined;
}

export interface ReportFontSet {
    regular?: Buffer;
    bold?: Buffer;
    urduRegular?: Buffer;
    urduBold?: Buffer;
}

let fontSetCache: ReportFontSet | null = null;

/**
 * Font buffers for the report theme. Latin faces are needed by every report;
 * the Urdu faces are returned too but the renderer only registers them when a
 * string actually contains Urdu/Arabic characters, which keeps ~1 MB of
 * fontkit parsing out of the common path.
 */
export function getReportFontSet(): ReportFontSet {
    if (fontSetCache) return fontSetCache;

    const theme = getReportFontTheme();
    const byFamily = new Map(theme.registrations.map((f) => [f.family, f.path]));

    fontSetCache = {
        regular: readCached(byFamily.get("App-Regular")),
        bold: readCached(byFamily.get("App-Bold")),
        urduRegular: readCached(byFamily.get("App-Urdu-Regular")),
        urduBold: readCached(byFamily.get("App-Urdu-Bold")),
    };
    return fontSetCache;
}

/** Cached logo bytes. Returns undefined when the file is missing. */
export function getImageAsset(filePath: string | undefined): Buffer | undefined {
    return readCached(filePath);
}

/** Drop every cached buffer (used when the process wants the memory back). */
export function clearAssetCache(): void {
    fileCache.clear();
    fontSetCache = null;
}
