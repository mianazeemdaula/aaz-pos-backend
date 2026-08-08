import { Tone } from "./report-theme";

/**
 * Declarative report description.
 *
 * A spec is plain JSON — no functions, no class instances — so it can be
 * structured-cloned onto a worker thread. Controllers describe *what* the
 * report contains; the renderer decides how it is drawn. This is what lets
 * PDF layout run off the main thread, and it keeps the per-request work in
 * the request handler down to "query the data, shape a few arrays".
 */

export type Align = "left" | "center" | "right";

export interface FilterChip {
    label: string;
    value: string;
}

export interface ReportHeaderSpec {
    title: string;
    subtitle?: string;
    companyName: string;
    address?: string;
    phone?: string;
    /** Absolute path to a logo image. Loaded (and cached) by the renderer. */
    logoPath?: string;
    /** Pre-formatted "generated at" stamp. Rendered as-is. */
    stamp?: string;
    filters?: FilterChip[];
}

export interface ReportFooterSpec {
    leftText?: string;
    centerText?: string;
    showPageNumber?: boolean;
}

export interface ReportPageSpec {
    size: "A4" | "A5" | "A3" | "Letter";
    orientation: "portrait" | "landscape";
    margins: { top: number; bottom: number; left: number; right: number };
}

export interface StatItem {
    label: string;
    value: string;
    /** Optional caption under the value (e.g. "vs. last month"). */
    note?: string;
    tone?: Tone;
}

export interface TableColumnSpec {
    label: string;
    width?: number | "*";
    align?: Align;
    /** Allow the cell to wrap onto multiple lines (costs a measure pass). */
    wrap?: boolean;
}

export interface TableCellSpec {
    text: string;
    align?: Align;
    bold?: boolean;
    tone?: Tone;
    colSpan?: number;
}

export type TableCell = string | number | null | undefined | TableCellSpec;

export interface TableBlock {
    type: "table";
    columns: TableColumnSpec[];
    rows: TableCell[][];
    /** Emphasised trailing row (grand totals). */
    totalRow?: TableCell[];
    zebra?: boolean;
    /**
     * Per-row highlight, parallel to `rows`. A tone paints the whole row in
     * that tone's tint, which is how status reports flag negative or low
     * stock without a colour-coded legend.
     */
    rowTones?: (Tone | undefined | null)[];
    fontSize?: number;
    /** Repeat the column head after a page break. Default true. */
    repeatHead?: boolean;
    /** Hide the head row entirely (for key/value style tables). */
    showHead?: boolean;
}

export interface StatsBlock {
    type: "stats";
    items: StatItem[];
    /** Cards per row. Auto-fitted when omitted. */
    columns?: number;
}

export interface SectionBlock {
    type: "section";
    title: string;
    subtitle?: string;
}

export interface TextBlock {
    type: "text";
    text: string;
    tone?: Tone;
    size?: number;
    bold?: boolean;
    align?: Align;
}

export interface DividerBlock {
    type: "divider";
}

export interface SpacerBlock {
    type: "spacer";
    height: number;
}

export interface PageBreakBlock {
    type: "pageBreak";
}

export interface SignatureSlot {
    label: string;
    name?: string;
    title?: string;
}

export interface SignaturesBlock {
    type: "signatures";
    items: SignatureSlot[];
}

export type ReportBlock =
    | StatsBlock
    | SectionBlock
    | TableBlock
    | TextBlock
    | DividerBlock
    | SpacerBlock
    | PageBreakBlock
    | SignaturesBlock;

export interface ReportSpec {
    page: ReportPageSpec;
    header: ReportHeaderSpec;
    footer: ReportFooterSpec;
    blocks: ReportBlock[];
    /** Suggested download name; used by sendReport. */
    filename: string;
    /** "attachment" (download) or "inline" (open in viewer). */
    disposition?: "attachment" | "inline";
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

export interface ReportBuilderOptions {
    title: string;
    subtitle?: string;
    filename: string;
    filters?: Record<string, string | number | null | undefined> | FilterChip[];
    orientation?: "portrait" | "landscape";
    size?: "A4" | "A5" | "A3" | "Letter";
    margins?: Partial<ReportPageSpec["margins"]>;
    company?: { name?: string; address?: string; phone?: string };
    logoPath?: string;
    stamp?: string;
    footer?: ReportFooterSpec;
    disposition?: "attachment" | "inline";
}

function normalizeFilters(
    filters: ReportBuilderOptions["filters"]
): FilterChip[] | undefined {
    if (!filters) return undefined;
    if (Array.isArray(filters)) return filters.filter((f) => f && f.label != null);
    const chips = Object.entries(filters)
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([label, value]) => ({ label, value: String(value) }));
    return chips.length ? chips : undefined;
}

/**
 * Fluent builder that accumulates a ReportSpec. Every method returns `this`
 * so report controllers read top-to-bottom like the document itself.
 */
export class ReportBuilder {
    readonly spec: ReportSpec;

    constructor(options: ReportBuilderOptions) {
        const orientation = options.orientation || "portrait";
        this.spec = {
            page: {
                size: options.size || "A4",
                orientation,
                margins: {
                    top: 22,
                    bottom: 22,
                    left: 24,
                    right: 24,
                    ...options.margins,
                },
            },
            header: {
                title: options.title,
                subtitle: options.subtitle,
                companyName: options.company?.name || "",
                address: options.company?.address,
                phone: options.company?.phone,
                logoPath: options.logoPath,
                stamp: options.stamp,
                filters: normalizeFilters(options.filters),
            },
            footer: {
                leftText: options.footer?.leftText ?? options.company?.name,
                centerText: options.footer?.centerText ?? options.title,
                showPageNumber: options.footer?.showPageNumber ?? true,
            },
            blocks: [],
            filename: options.filename,
            disposition: options.disposition || "attachment",
        };
    }

    /** KPI cards. Replaces the old "summary table" pattern. */
    stats(items: StatItem[], columns?: number): this {
        const clean = items.filter(Boolean);
        if (clean.length) this.spec.blocks.push({ type: "stats", items: clean, columns });
        return this;
    }

    section(title: string, subtitle?: string): this {
        this.spec.blocks.push({ type: "section", title, subtitle });
        return this;
    }

    table(table: Omit<TableBlock, "type">): this {
        this.spec.blocks.push({ type: "table", ...table });
        return this;
    }

    text(text: string, options: Omit<TextBlock, "type" | "text"> = {}): this {
        this.spec.blocks.push({ type: "text", text, ...options });
        return this;
    }

    /** Muted one-liner, e.g. "No records for this period." */
    note(text: string): this {
        return this.text(text, { tone: "muted", size: 8 });
    }

    divider(): this {
        this.spec.blocks.push({ type: "divider" });
        return this;
    }

    spacer(height = 8): this {
        this.spec.blocks.push({ type: "spacer", height });
        return this;
    }

    /** Sign-off lines, laid out evenly across the page. */
    signatures(items: SignatureSlot[]): this {
        if (items.length) this.spec.blocks.push({ type: "signatures", items });
        return this;
    }

    pageBreak(): this {
        this.spec.blocks.push({ type: "pageBreak" });
        return this;
    }

    get isEmpty(): boolean {
        return this.spec.blocks.length === 0;
    }
}
