import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { PDFDocumentType } from "./pdfkit-types";

/**
 * Font Support for PDFKit - Including Urdu/Arabic Support
 */

export interface FontDefinition {
    name: string;
    path: string;
    family?: string;
}

export interface ReportFontTheme {
    regular: string;
    bold: string;
    urduRegular?: string;
    urduBold?: string;
    registrations: FontDefinition[];
    aliasMap: Record<string, string>;
}

const FONT_ALIAS_KEY = "__pdfFontAliases";
const FONT_URDU_FAMILY_KEY = "__pdfUrduFontFamily";
const FONT_URDU_PATCHED_KEY = "__pdfUrduTextPatched";

const PROJECT_ROOT_CANDIDATES = [
    () => process.cwd(),
    () => path.dirname(process.execPath),
    () => path.resolve(__dirname, "../../.."),
    () => path.resolve(__dirname, "../../../.."),
];

function findProjectRoot(): string {
    for (const candidateFactory of PROJECT_ROOT_CANDIDATES) {
        const candidate = candidateFactory();
        if (!candidate) {
            continue;
        }

        const packageJsonPath = path.join(candidate, "package.json");
        if (fs.existsSync(packageJsonPath)) {
            return candidate;
        }
    }

    return process.cwd();
}

function getFontsDirectory(): string {
    return path.join(findProjectRoot(), "fonts");
}

function toFamilyName(fileName: string): string {
    const withoutExt = fileName.replace(/\.(ttf|otf)$/i, "");
    return withoutExt
        .replace(/[_-]+/g, " ")
        .trim();
}

function scanFontFilesRecursively(directoryPath: string): string[] {
    if (!fs.existsSync(directoryPath)) {
        return [];
    }

    const results: string[] = [];
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...scanFontFilesRecursively(fullPath));
            continue;
        }

        if (/\.(ttf|otf)$/i.test(entry.name)) {
            results.push(fullPath);
        }
    }

    return results;
}

function pickFontFile(fontPaths: string[], patterns: RegExp[]): string | undefined {
    for (const pattern of patterns) {
        const match = fontPaths.find((fontPath) => pattern.test(path.basename(fontPath).toLowerCase()));
        if (match) {
            return match;
        }
    }

    return undefined;
}

export const AVAILABLE_FONTS = {
    // Standard fonts (built-in)
    HELVETICA: "Helvetica",
    HELVETICA_BOLD: "Helvetica-Bold",
    HELVETICA_OBLIQUE: "Helvetica-Oblique",
    TIMES: "Times-Roman",
    TIMES_BOLD: "Times-Bold",
    COURIER: "Courier",

    // Custom fonts (require registration)
    URDU: "NotoNaskhArabic",
    ARABIC: "NotoNaskhArabic",
};

/**
 * Common Urdu/Arabic fonts that can be downloaded
 * Download from Google Fonts: https://fonts.google.com/
 */
export const URDU_FONTS: FontDefinition[] = [
    {
        name: "NotoNastaliqUrdu-Regular",
        family: "NotoNastaliqUrdu",
        path: path.join(getFontsDirectory(), "NotoNastaliqUrdu-Regular.ttf"),
    },
    {
        name: "NotoNastaliqUrdu-Bold",
        family: "NotoNastaliqUrdu-Bold",
        path: path.join(getFontsDirectory(), "NotoNastaliqUrdu-Bold.ttf"),
    },
    {
        name: "Jameel Noori Nastaleeq",
        family: "JameelNoori",
        path: path.join(getFontsDirectory(), "JameelNooriNastaleeq.ttf"),
    },
];

export function getReportFontTheme(): ReportFontTheme {
    const fontsDirectory = getFontsDirectory();
    const fontPaths = scanFontFilesRecursively(fontsDirectory);

    const regularPath = pickFontFile(fontPaths, [
        /calibri[-_ ]regular\.(ttf|otf)$/,
        /regular\.(ttf|otf)$/,
        /calibri\.(ttf|otf)$/,
    ]);

    const boldPath = pickFontFile(fontPaths, [
        /calibri[-_ ]bold\.(ttf|otf)$/,
        /bold\.(ttf|otf)$/,
    ]);

    const urduRegularPath = pickFontFile(fontPaths, [
        /notonastaliqurdu[-_ ]regular\.(ttf|otf)$/,
        /noto.*urdu.*regular\.(ttf|otf)$/,
        /urdu.*regular\.(ttf|otf)$/,
        /notonaskh.*regular\.(ttf|otf)$/,
    ]);

    const urduBoldPath = pickFontFile(fontPaths, [
        /notonastaliqurdu[-_ ]bold\.(ttf|otf)$/,
        /noto.*urdu.*bold\.(ttf|otf)$/,
        /urdu.*bold\.(ttf|otf)$/,
        /notonaskh.*bold\.(ttf|otf)$/,
    ]);

    const registrations: FontDefinition[] = [];

    if (regularPath) {
        registrations.push({
            name: toFamilyName(path.basename(regularPath)),
            family: "App-Regular",
            path: regularPath,
        });
    }

    if (boldPath) {
        registrations.push({
            name: toFamilyName(path.basename(boldPath)),
            family: "App-Bold",
            path: boldPath,
        });
    }

    if (urduRegularPath) {
        registrations.push({
            name: toFamilyName(path.basename(urduRegularPath)),
            family: "App-Urdu-Regular",
            path: urduRegularPath,
        });
    }

    if (urduBoldPath) {
        registrations.push({
            name: toFamilyName(path.basename(urduBoldPath)),
            family: "App-Urdu-Bold",
            path: urduBoldPath,
        });
    }

    const regularFamily = regularPath ? "App-Regular" : AVAILABLE_FONTS.HELVETICA;
    const boldFamily = boldPath ? "App-Bold" : (regularPath ? "App-Regular" : AVAILABLE_FONTS.HELVETICA_BOLD);
    const urduRegularFamily = urduRegularPath ? "App-Urdu-Regular" : undefined;
    const urduBoldFamily = urduBoldPath ? "App-Urdu-Bold" : (urduRegularPath ? "App-Urdu-Regular" : undefined);

    return {
        regular: regularFamily,
        bold: boldFamily,
        urduRegular: urduRegularFamily,
        urduBold: urduBoldFamily,
        registrations,
        aliasMap: {
            Helvetica: regularFamily,
            "Helvetica-Oblique": regularFamily,
            "Times-Roman": regularFamily,
            Courier: regularFamily,
            "Helvetica-Bold": boldFamily,
            "Times-Bold": boldFamily,
        },
    };
}

export function applyDocumentFontAliases(doc: PDFDocumentType, aliasMap: Record<string, string>): void {
    const currentAliases = ((doc as any)[FONT_ALIAS_KEY] || {}) as Record<string, string>;
    (doc as any)[FONT_ALIAS_KEY] = {
        ...currentAliases,
        ...aliasMap,
    };
}

export function resolveDocumentFontFamily(doc: PDFDocumentType, requestedFamily: string): string {
    const aliasMap = ((doc as any)[FONT_ALIAS_KEY] || {}) as Record<string, string>;
    return aliasMap[requestedFamily] || requestedFamily;
}

export function setDocumentUrduFontFamily(doc: PDFDocumentType, urduFontFamily?: string): void {
    if (!urduFontFamily) {
        return;
    }

    (doc as any)[FONT_URDU_FAMILY_KEY] = urduFontFamily;
}

export function getDocumentUrduFontFamily(doc: PDFDocumentType): string | undefined {
    return (doc as any)[FONT_URDU_FAMILY_KEY] as string | undefined;
}

export function patchDocumentTextForUrdu(doc: PDFDocumentType): void {
    const mutableDoc = doc as any;
    if (mutableDoc[FONT_URDU_PATCHED_KEY]) {
        return;
    }

    const originalText = mutableDoc.text.bind(doc);
    mutableDoc.text = (text: any, ...args: any[]) => {
        if (typeof text === "string" && isUrduText(text)) {
            const urduFamily = getDocumentUrduFontFamily(doc);
            if (urduFamily) {
                try {
                    doc.font(urduFamily);
                } catch (error) {
                    console.warn(`⚠ Failed to switch to Urdu font '${urduFamily}':`, error);
                }
            }
        }

        return originalText(text, ...args);
    };

    mutableDoc[FONT_URDU_PATCHED_KEY] = true;
}

/**
 * Register custom fonts with PDFDocument
 */
export function registerFonts(doc: PDFDocumentType, fonts: FontDefinition[]): void {
    fonts.forEach((font) => {
        if (fs.existsSync(font.path)) {
            doc.registerFont(font.family || font.name, font.path);
            console.log(`✓ Registered font: ${font.name}`);
        } else {
            console.warn(`⚠ Font file not found: ${font.path}`);
        }
    });
}

/**
 * Auto-register Urdu fonts if available
 */
export function registerUrduFonts(doc: PDFDocumentType): boolean {
    const availableFonts = URDU_FONTS.filter((font) => fs.existsSync(font.path));

    if (availableFonts.length > 0) {
        registerFonts(doc, availableFonts);
        return true;
    }

    console.warn("⚠ No Urdu fonts found. Please download and place in /fonts directory.");
    return false;
}

/**
 * Check if text contains Urdu/Arabic characters
 */
export function isUrduText(text: string): boolean {
    // Arabic/Urdu Unicode range: U+0600 to U+06FF, U+0750 to U+077F, U+FB50 to U+FDFF, U+FE70 to U+FEFF
    const urduRegex = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
    return urduRegex.test(text);
}

/**
 * Render text with automatic font switching for Urdu support
 */
export function renderTextWithUrduSupport(
    doc: PDFDocumentType,
    text: string,
    x: number,
    y: number,
    options: any = {}
): void {
    // Default to Helvetica if no font is currently set
    const currentFont = "Helvetica";

    if (isUrduText(text)) {
        // Switch to Urdu font
        const urduFont = URDU_FONTS.find((font) => fs.existsSync(font.path));
        if (urduFont) {
            doc.font(urduFont.family || urduFont.name);
            // Urdu text is RTL (right-to-left)
            doc.text(text, x, y, { ...options, align: options.align || "right" });
            // Restore previous font
            doc.font(currentFont);
        } else {
            // Fallback to default font
            doc.text(text, x, y, options);
        }
    } else {
        doc.text(text, x, y, options);
    }
}

/**
 * Font installation guide
 */
export function printFontInstallationGuide(): string {
    return `
=======================================================
Urdu/Arabic Font Installation Guide
=======================================================

To enable Urdu/Arabic text support in PDFs:

1. Create a 'fonts' directory in the root of your project:
   mkdir fonts

2. Download Noto Nasakh Arabic font from Google Fonts:
   https://fonts.google.com/noto/specimen/Noto+Naskh+Arabic

3. Extract and copy the .ttf files to the fonts directory:
   - NotoNaskhArabic-Regular.ttf
   - NotoNaskhArabic-Bold.ttf

4. Alternative: Download Jameel Noori Nastaleeq:
   http://www.jameel.org/jameel-noori-nastaleeq

Expected font paths:
${URDU_FONTS.map((f) => `  - ${f.path}`).join("\n")}

=======================================================
`;
}

/**
 * Check font availability and print status
 */
export function checkFontAvailability(): {
    available: FontDefinition[];
    missing: FontDefinition[];
} {
    const available: FontDefinition[] = [];
    const missing: FontDefinition[] = [];

    URDU_FONTS.forEach((font) => {
        if (fs.existsSync(font.path)) {
            available.push(font);
        } else {
            missing.push(font);
        }
    });

    console.log("\n=== Font Availability Status ===");
    console.log(`✓ Available: ${available.length}`);
    available.forEach((f) => console.log(`  - ${f.name}`));

    console.log(`✗ Missing: ${missing.length}`);
    missing.forEach((f) => console.log(`  - ${f.name}`));

    if (missing.length > 0) {
        console.log("\n" + printFontInstallationGuide());
    }

    return { available, missing };
}
