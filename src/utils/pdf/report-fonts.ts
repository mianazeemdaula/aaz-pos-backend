import fs from "fs";
import path from "path";

/**
 * Font discovery for reports.
 *
 * The install ships a `fonts/` directory; whichever Latin and Urdu faces are
 * present get picked up here. Resolution touches the filesystem, so the result
 * is computed once per process and cached — it cannot change while the server
 * is running.
 */

export interface FontDefinition {
    name: string;
    path: string;
    family: string;
}

export interface ReportFontTheme {
    registrations: FontDefinition[];
    /** True when a Latin face was found; otherwise PDFKit's Helvetica is used. */
    hasLatin: boolean;
    /** True when an Urdu/Arabic face was found. */
    hasUrdu: boolean;
}

const PROJECT_ROOT_CANDIDATES = [
    () => process.cwd(),
    () => path.dirname(process.execPath),
    () => path.resolve(__dirname, "../../.."),
    () => path.resolve(__dirname, "../../../.."),
];

function findProjectRoot(): string {
    for (const candidateFactory of PROJECT_ROOT_CANDIDATES) {
        const candidate = candidateFactory();
        if (!candidate) continue;
        if (fs.existsSync(path.join(candidate, "package.json"))) {
            return candidate;
        }
    }
    return process.cwd();
}

function scanFontFilesRecursively(directoryPath: string): string[] {
    if (!fs.existsSync(directoryPath)) return [];

    const results: string[] = [];
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...scanFontFilesRecursively(fullPath));
        } else if (/\.(ttf|otf)$/i.test(entry.name)) {
            results.push(fullPath);
        }
    }
    return results;
}

/** First font file whose basename matches one of the patterns, in order. */
function pickFontFile(fontPaths: string[], patterns: RegExp[]): string | undefined {
    for (const pattern of patterns) {
        const match = fontPaths.find((fontPath) => pattern.test(path.basename(fontPath).toLowerCase()));
        if (match) return match;
    }
    return undefined;
}

function toFontName(filePath: string): string {
    return path.basename(filePath).replace(/\.(ttf|otf)$/i, "").replace(/[_-]+/g, " ").trim();
}

let cache: ReportFontTheme | null = null;

export function getReportFontTheme(): ReportFontTheme {
    if (!cache) cache = resolveReportFontTheme();
    return cache;
}

/** Maintenance hook: drop the cached theme so the next call rescans. */
export function clearReportFontThemeCache(): void {
    cache = null;
}

function resolveReportFontTheme(): ReportFontTheme {
    const fontPaths = scanFontFilesRecursively(path.join(findProjectRoot(), "fonts"));

    const picks: [string, string | undefined][] = [
        [
            "App-Regular",
            pickFontFile(fontPaths, [
                /calibri[-_ ]regular\.(ttf|otf)$/,
                /regular\.(ttf|otf)$/,
                /calibri\.(ttf|otf)$/,
            ]),
        ],
        ["App-Bold", pickFontFile(fontPaths, [/calibri[-_ ]bold\.(ttf|otf)$/, /bold\.(ttf|otf)$/])],
        [
            "App-Urdu-Regular",
            pickFontFile(fontPaths, [
                /notonastaliqurdu[-_ ]regular\.(ttf|otf)$/,
                /noto.*urdu.*regular\.(ttf|otf)$/,
                /urdu.*regular\.(ttf|otf)$/,
                /notonaskh.*regular\.(ttf|otf)$/,
            ]),
        ],
        [
            "App-Urdu-Bold",
            pickFontFile(fontPaths, [
                /notonastaliqurdu[-_ ]bold\.(ttf|otf)$/,
                /noto.*urdu.*bold\.(ttf|otf)$/,
                /urdu.*bold\.(ttf|otf)$/,
                /notonaskh.*bold\.(ttf|otf)$/,
            ]),
        ],
    ];

    const registrations: FontDefinition[] = [];
    for (const [family, filePath] of picks) {
        if (filePath) {
            registrations.push({ family, path: filePath, name: toFontName(filePath) });
        }
    }

    return {
        registrations,
        hasLatin: registrations.some((f) => f.family === "App-Regular"),
        hasUrdu: registrations.some((f) => f.family === "App-Urdu-Regular"),
    };
}
