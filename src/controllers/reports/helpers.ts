import dayjs from "dayjs";
import fs from "fs";
import path from "path";
import { ReportBuilder, ReportBuilderOptions } from "../../utils/pdf/report-spec";
import { sendReport } from "../../utils/pdf/report";
import { readSettings } from "../settings.controller";

export { readSettings, sendReport };
export type { ReportBuilder };

export const logoPath = path.join(__dirname, "../../../logo/logo.jpg");

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

/** Probed once — the logo either ships with the install or it does not. */
let logoExists: boolean | null = null;
function resolveLogoPath(): string | undefined {
    if (logoExists === null) {
        logoExists = fs.existsSync(logoPath);
    }
    return logoExists ? logoPath : undefined;
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
