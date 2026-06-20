import dayjs from "dayjs";
import path from "path";
import QRCode from "qrcode";
import { getReportFontTheme, createPDFGenerator } from "../../utils/pdf";
import { readSettings } from "../settings.controller";

export { createPDFGenerator, readSettings };

export const logoPath = path.join(__dirname, "../../../logo/logo.jpg");

export function fonts() {
    return getReportFontTheme();
}

export function fmtCurrency(v: any) {
    return v != null ? Number(v).toLocaleString() : "0";
}

export function fmtDate(v: any, fmt = "DD MMM YYYY") {
    return v ? dayjs(v).format(fmt) : "N/A";
}

/**
 * Returns a trustworthy avg cost price.
 * If avgCostPrice is corrupted (negative, non-finite, or > 1 billion — caused by
 * the weighted-average formula compounding on negative stock), falls back to 95%
 * of the variant sale price.
 */
export function safeAvgCost(avgCostPrice: number, variantPrice: number): number {
    if (avgCostPrice > 0 && Number.isFinite(avgCostPrice) && avgCostPrice < 1e9) {
        return avgCostPrice;
    }
    const fallback = variantPrice * 0.95;
    return fallback > 0 ? fallback : 0;
}

export function pdfConfig(
    title: string,
    subtitle: string,
    filterInfo: Record<string, string | number>,
    orientation: "portrait" | "landscape" = "portrait",
    size: "A4" | "A5" | "A3" = "A4",
    qrCodeBuffer?: Buffer
) {
    const reportFonts = fonts();
    const company = readSettings();
    return {
        fontRegistrations: reportFonts.registrations,
        fontFamilyMap: reportFonts.aliasMap,
        pdfOptions: {
            size: size as any,
            orientation,
            margins: { top: 10, bottom: 10, left: 20, right: 20 },
        },
        header: {
            title,
            subtitle,
            logo: { path: logoPath, width: 55, height: 55 },
            companyName: (company.businessName as string) || undefined,
            address: (company.address as string) || undefined,
            phone: (company.phone as string) || undefined,
            showDate: true,
            titleFont: { family: "Helvetica-Bold" as const, size: 14, color: "#1e40af" },
            subtitleFont: { size: 9, color: "#475569" },
            filterInfo,
            qrCode: qrCodeBuffer,
            qrCodeSize: 55,
        },
        footer: {
            leftText: (company.businessName as string) || "POS System",
            centerText: title,
            showPageNumber: true,
            font: { size: 8, color: "#666666" },
        },
    };
}

export async function generateQRBuffer(text: string): Promise<Buffer | undefined> {
    try {
        return await QRCode.toBuffer(text, { width: 150, margin: 1, color: { dark: "#1e293b", light: "#ffffff" } });
    } catch {
        return undefined;
    }
}
