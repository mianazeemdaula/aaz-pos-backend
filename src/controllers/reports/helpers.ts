import dayjs from "dayjs";
import fs from "fs";
import { ReportBuilder, ReportBuilderOptions } from "../../utils/pdf/report-spec";
import { sendReport } from "../../utils/pdf/report";
import { readSettings, LOGO_PATH as UPLOADED_LOGO_PATH } from "../settings.controller";

export { readSettings, sendReport };
export type { ReportBuilder };

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

/** PDFKit can only draw PNG and JPEG; anything else would leave a blank header. */
function isPngOrJpeg(filePath: string): boolean {
    let fd: number | undefined;
    try {
        fd = fs.openSync(filePath, "r");
        const head = Buffer.alloc(4);
        fs.readSync(fd, head, 0, 4, 0);
        return head.readUInt32BE(0) === 0x89504e47 || (head[0] === 0xff && head[1] === 0xd8);
    } catch {
        return false;
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

/**
 * Reports carry the business's own logo from Settings → Company, or none at all.
 * Checked on every report because the upload can change or be removed at any time.
 */
function resolveLogoPath(): string | undefined {
    return isPngOrJpeg(UPLOADED_LOGO_PATH) ? UPLOADED_LOGO_PATH : undefined;
}

export type ReportOptions = Omit<ReportBuilderOptions, "company" | "logoPath" | "stamp"> & {
    stamp?: string;
};

/**
 * Start a report pre-filled with the company identity from settings.
 *
 * The returned builder only collects a description of the document; nothing is
 * drawn until `sendReport` hands the spec to a rendering thread.
 */
export function createReport(options: ReportOptions): ReportBuilder {
    const company = readSettings();
    return new ReportBuilder({
        ...options,
        company: {
            name: (company.businessName as string) || "POS System",
            address: (company.address as string) || undefined,
            phone: (company.phone as string) || undefined,
        },
        logoPath: resolveLogoPath(),
        stamp: options.stamp ?? `Generated ${dayjs().format("DD MMM YYYY, hh:mm A")}`,
    });
}

/** Filename helper: `sales-report-2026-08-08.pdf`. */
export function reportFilename(slug: string): string {
    return `${slug}-${dayjs().format("YYYY-MM-DD")}.pdf`;
}
