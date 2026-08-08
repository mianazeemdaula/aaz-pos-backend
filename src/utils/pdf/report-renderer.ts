import PDFDocument from "pdfkit";
import {
    ReportSpec,
    ReportBlock,
    StatsBlock,
    SectionBlock,
    TableBlock,
    TextBlock,
    TableCell,
    TableCellSpec,
    SignaturesBlock,
    Align,
} from "./report-spec";
import { COLORS, SPACING, TYPE, Tone, toneStyle } from "./report-theme";
import { getImageAsset, getReportFontSet } from "./report-assets";

/**
 * Report renderer.
 *
 * Draws a ReportSpec with explicit coordinates instead of relying on PDFKit's
 * text flow or its built-in table. That is deliberate:
 *
 *   - PDFKit's `doc.table()` measures every cell of every row before it can
 *     place anything, which is the single most expensive thing the old
 *     reports did. Here only columns explicitly marked `wrap` are measured;
 *     everything else uses a fixed row height and is clipped with an ellipsis.
 *   - Owning the cursor means no monkey-patching of `doc.text`, no juggling of
 *     `page.margins` to fake page breaks, and no chance of the footer pushing
 *     a page of its own.
 *
 * The whole class is synchronous CPU work, which is exactly why it is meant to
 * run on a worker thread (see pdf-worker-pool.ts).
 */

type PDFDoc = InstanceType<typeof PDFDocument>;

const FONT = {
    regular: "R",
    bold: "B",
    urdu: "U",
    urduBold: "UB",
} as const;

const URDU_RANGE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

const CELL_PAD = 5;
/** Floor for any column, so a mis-specified table can never collapse one. */
const MIN_COLUMN_WIDTH = 14;
/** Floor for the text area inside a cell; PDFKit loops on non-positive widths. */
const MIN_TEXT_WIDTH = 8;
const HEAD_HEIGHT = 18;
const MAX_ROW_HEIGHT = 140;

interface TextStyle {
    size?: number;
    color?: string;
    bold?: boolean;
    align?: Align;
    width?: number;
    height?: number;
    lineBreak?: boolean;
    ellipsis?: boolean;
    characterSpacing?: number;
}

function cellOf(cell: TableCell): TableCellSpec {
    if (cell === null || cell === undefined) return { text: "" };
    if (typeof cell === "object") return cell;
    return { text: String(cell) };
}

class ReportRenderer {
    private readonly doc: PDFDoc;
    private readonly spec: ReportSpec;

    /** Left edge and width of the content column. */
    private x0 = 0;
    private contentWidth = 0;
    /** Lowest y body content may occupy before a page break is required. */
    private contentBottom = 0;
    private y = 0;
    private pageIndex = 0;

    private latinRegistered = false;
    private urduRegistered = false;
    private urduAvailable = false;

    constructor(spec: ReportSpec) {
        this.spec = spec;
        const { page } = spec;

        this.doc = new PDFDocument({
            size: page.size,
            layout: page.orientation,
            margins: page.margins,
            bufferPages: true,
            autoFirstPage: false,
            compress: true,
            info: { Title: spec.header.title, Author: spec.header.companyName },
        });

        this.registerFonts();
    }

    /* -------------------------------------------------------------- */
    /* Fonts                                                           */
    /* -------------------------------------------------------------- */

    private registerFonts(): void {
        const fonts = getReportFontSet();
        if (fonts.regular) {
            this.doc.registerFont(FONT.regular, fonts.regular);
            this.doc.registerFont(FONT.bold, fonts.bold || fonts.regular);
            this.latinRegistered = true;
        }
        this.urduAvailable = Boolean(fonts.urduRegular);
    }

    /**
     * Urdu faces are ~1 MB of TrueType that fontkit would otherwise parse for
     * every single report. They are registered the first time a string that
     * actually needs them shows up, so English-only reports never pay for it.
     */
    private ensureUrduFonts(): void {
        if (this.urduRegistered) return;
        const fonts = getReportFontSet();
        if (!fonts.urduRegular) {
            this.urduAvailable = false;
            return;
        }
        this.doc.registerFont(FONT.urdu, fonts.urduRegular);
        this.doc.registerFont(FONT.urduBold, fonts.urduBold || fonts.urduRegular);
        this.urduRegistered = true;
    }

    private fontFor(text: string, bold?: boolean): string {
        if (this.urduAvailable && URDU_RANGE.test(text)) {
            this.ensureUrduFonts();
            if (this.urduRegistered) return bold ? FONT.urduBold : FONT.urdu;
        }
        if (!this.latinRegistered) return bold ? "Helvetica-Bold" : "Helvetica";
        return bold ? FONT.bold : FONT.regular;
    }

    private applyFont(text: string, style: TextStyle): void {
        this.doc
            .font(this.fontFor(text, style.bold))
            .fontSize(style.size ?? TYPE.tableBody)
            .fillColor(style.color ?? COLORS.body);
    }

    /* -------------------------------------------------------------- */
    /* Primitives                                                      */
    /* -------------------------------------------------------------- */

    private txt(text: string, x: number, y: number, style: TextStyle = {}): void {
        const value = text ?? "";
        this.applyFont(value, style);
        this.doc.text(value, x, y, {
            width: style.width,
            height: style.height,
            align: style.align || "left",
            lineBreak: style.lineBreak ?? false,
            ellipsis: style.ellipsis ?? true,
            characterSpacing: style.characterSpacing,
        });
    }

    /** Height a single line of the given style occupies. */
    private lineHeight(size: number, bold = false): number {
        this.doc.font(this.latinRegistered ? (bold ? FONT.bold : FONT.regular) : "Helvetica").fontSize(size);
        return this.doc.currentLineHeight();
    }

    private rule(y: number, color: string, width: number, x?: number, w?: number): void {
        this.doc
            .moveTo(x ?? this.x0, y)
            .lineTo((x ?? this.x0) + (w ?? this.contentWidth), y)
            .strokeColor(color)
            .lineWidth(width)
            .stroke();
    }

    private measure(text: string, size: number, bold = false): number {
        this.doc.font(this.fontFor(text, bold)).fontSize(size);
        return this.doc.widthOfString(text);
    }

    /* -------------------------------------------------------------- */
    /* Page lifecycle                                                  */
    /* -------------------------------------------------------------- */

    private startPage(): void {
        this.doc.addPage();
        this.pageIndex += 1;

        const page = this.doc.page;
        // Nothing in this renderer relies on PDFKit's automatic flow, and a
        // zero bottom margin guarantees a stray `text` call can never spawn a
        // page of its own (the bug that used to strand footers).
        page.margins.bottom = 0;

        this.x0 = this.spec.page.margins.left;
        this.contentWidth = page.width - this.spec.page.margins.left - this.spec.page.margins.right;
        this.contentBottom =
            page.height - this.spec.page.margins.bottom - SPACING.footerHeight - SPACING.footerGap;

        this.y = this.drawHeader(this.pageIndex > 1);
    }

    private ensureSpace(height: number): void {
        if (this.y + height > this.contentBottom) {
            this.startPage();
        }
    }

    /* -------------------------------------------------------------- */
    /* Header                                                          */
    /* -------------------------------------------------------------- */

    private drawHeader(compact: boolean): number {
        return compact ? this.drawCompactHeader() : this.drawFullHeader();
    }

    /**
     * Page 1 masthead: identity on the left, report identity on the right,
     * separated by a two-tone accent rule, with the active filters rendered as
     * chips underneath.
     */
    private drawFullHeader(): number {
        const h = this.spec.header;
        const top = this.spec.page.margins.top;
        const right = this.x0 + this.contentWidth;

        let logoWidth = 0;
        const logo = getImageAsset(h.logoPath);
        if (logo) {
            const box = 44;
            try {
                this.doc.image(logo, this.x0, top, { fit: [box, box], align: "center", valign: "center" });
                logoWidth = box + 11;
            } catch {
                logoWidth = 0;
            }
        }

        // ── Left: company identity ─────────────────────────────────
        const identityX = this.x0 + logoWidth;
        const identityWidth = Math.min(this.contentWidth * 0.42, 230);
        let leftY = top + 1;

        if (h.companyName) {
            this.txt(h.companyName.toUpperCase(), identityX, leftY, {
                size: TYPE.company,
                bold: true,
                color: COLORS.ink,
                width: identityWidth,
                characterSpacing: 0.2,
            });
            leftY += this.lineHeight(TYPE.company, true) + 2;
        }
        if (h.address) {
            this.txt(h.address, identityX, leftY, {
                size: TYPE.companyMeta,
                color: COLORS.muted,
                width: identityWidth,
            });
            leftY += this.lineHeight(TYPE.companyMeta) + 1;
        }
        if (h.phone) {
            this.txt(`Tel ${h.phone}`, identityX, leftY, {
                size: TYPE.companyMeta,
                color: COLORS.muted,
                width: identityWidth,
            });
            leftY += this.lineHeight(TYPE.companyMeta);
        }

        // ── Right: report identity ─────────────────────────────────
        const titleWidth = Math.max(160, this.contentWidth - logoWidth - identityWidth - 14);
        const titleX = right - titleWidth;
        let rightY = top;

        this.txt(h.title, titleX, rightY, {
            size: TYPE.title,
            bold: true,
            color: COLORS.primary,
            width: titleWidth,
            align: "right",
        });
        rightY += this.lineHeight(TYPE.title, true) + 1;

        if (h.subtitle) {
            this.txt(h.subtitle, titleX, rightY, {
                size: TYPE.subtitle,
                color: COLORS.muted,
                width: titleWidth,
                align: "right",
            });
            rightY += this.lineHeight(TYPE.subtitle) + 1;
        }
        if (h.stamp) {
            this.txt(h.stamp, titleX, rightY, {
                size: TYPE.stamp,
                color: COLORS.faint,
                width: titleWidth,
                align: "right",
            });
            rightY += this.lineHeight(TYPE.stamp);
        }

        let y = Math.max(leftY, rightY, top + (logo ? 44 : 0)) + 6;

        // Two-tone divider: a confident accent line over a hairline.
        this.rule(y, COLORS.primary, 1.6);
        this.rule(y + 2.6, COLORS.border, 0.5);
        y += SPACING.headerGap;

        y = this.drawFilterChips(y, h.filters);
        return y;
    }

    /** Pages 2+ get a slim running head so the data keeps the room. */
    private drawCompactHeader(): number {
        const h = this.spec.header;
        const top = this.spec.page.margins.top;

        if (h.companyName) {
            this.txt(h.companyName.toUpperCase(), this.x0, top, {
                size: 8,
                bold: true,
                color: COLORS.muted,
                width: this.contentWidth * 0.5,
                characterSpacing: 0.2,
            });
        }
        this.txt(h.title, this.x0 + this.contentWidth * 0.5, top, {
            size: 8,
            bold: true,
            color: COLORS.primary,
            width: this.contentWidth * 0.5,
            align: "right",
        });

        const y = top + this.lineHeight(8, true) + 4;
        this.rule(y, COLORS.border, 0.8);
        return y + 8;
    }

    private drawFilterChips(startY: number, filters?: { label: string; value: string }[]): number {
        if (!filters || filters.length === 0) return startY;

        const gap = SPACING.chipGap;
        const height = SPACING.chipHeight;
        let x = this.x0;
        let y = startY;

        for (const chip of filters) {
            const label = `${chip.label}`;
            const value = `${chip.value}`;
            const labelW = this.measure(label, TYPE.chip, true);
            const valueW = this.measure(value, TYPE.chip);
            const chipW = labelW + valueW + 20;

            if (x > this.x0 && x + chipW > this.x0 + this.contentWidth) {
                x = this.x0;
                y += height + 4;
            }

            this.doc.roundedRect(x, y, chipW, height, SPACING.chipRadius).fill(COLORS.primarySoft);

            const textY = y + (height - this.lineHeight(TYPE.chip)) / 2;
            this.txt(label, x + 8, textY, { size: TYPE.chip, bold: true, color: COLORS.primaryInk });
            this.txt(value, x + 8 + labelW + 4, textY, { size: TYPE.chip, color: COLORS.ink });

            x += chipW + gap;
        }

        return y + height + SPACING.blockGap;
    }

    /* -------------------------------------------------------------- */
    /* Footer                                                          */
    /* -------------------------------------------------------------- */

    private stampFooters(): void {
        const { footer } = this.spec;
        const range = this.doc.bufferedPageRange();

        for (let i = 0; i < range.count; i++) {
            this.doc.switchToPage(range.start + i);
            const page = this.doc.page;
            page.margins.bottom = 0;

            const width = page.width - this.spec.page.margins.left - this.spec.page.margins.right;
            const top = page.height - this.spec.page.margins.bottom - SPACING.footerHeight;
            const textY = top + (SPACING.footerHeight - this.lineHeight(TYPE.footer)) / 2 + 3;

            this.rule(top, COLORS.border, 0.5, this.spec.page.margins.left, width);

            const third = width / 3;
            if (footer.leftText) {
                this.txt(footer.leftText, this.x0, textY, {
                    size: TYPE.footer,
                    color: COLORS.faint,
                    width: third - 6,
                });
            }
            if (footer.centerText) {
                this.txt(footer.centerText, this.x0 + third, textY, {
                    size: TYPE.footer,
                    color: COLORS.faint,
                    width: third,
                    align: "center",
                });
            }
            if (footer.showPageNumber !== false) {
                this.txt(`Page ${i + 1} of ${range.count}`, this.x0 + 2 * third, textY, {
                    size: TYPE.footer,
                    color: COLORS.faint,
                    width: third,
                    align: "right",
                });
            }
        }
    }

    /* -------------------------------------------------------------- */
    /* Blocks                                                          */
    /* -------------------------------------------------------------- */

    private drawBlock(block: ReportBlock): void {
        switch (block.type) {
            case "stats":
                return this.drawStats(block);
            case "section":
                return this.drawSection(block);
            case "table":
                return this.drawTable(block);
            case "text":
                return this.drawText(block);
            case "divider":
                this.ensureSpace(SPACING.blockGap);
                this.rule(this.y, COLORS.border, 0.5);
                this.y += SPACING.blockGap;
                return;
            case "spacer":
                this.y = Math.min(this.y + block.height, this.contentBottom);
                return;
            case "signatures":
                return this.drawSignatures(block);
            case "pageBreak":
                this.startPage();
                return;
        }
    }

    private drawSignatures(block: SignaturesBlock): void {
        const count = block.items.length;
        if (!count) return;

        const slotWidth = this.contentWidth / count;
        const lineWidth = Math.min(slotWidth - 24, 150);
        const height = 46;

        this.ensureSpace(height + 14);
        this.y += 14;

        block.items.forEach((slot, index) => {
            const x = this.x0 + index * slotWidth + (slotWidth - lineWidth) / 2;
            this.rule(this.y, COLORS.borderStrong, 0.6, x, lineWidth);

            this.txt(slot.label, x, this.y + 5, {
                size: 8,
                bold: true,
                color: COLORS.body,
                width: lineWidth,
                align: "center",
            });
            if (slot.name) {
                this.txt(slot.name, x, this.y + 17, {
                    size: 8,
                    color: COLORS.muted,
                    width: lineWidth,
                    align: "center",
                });
            }
            if (slot.title) {
                this.txt(slot.title, x, this.y + (slot.name ? 28 : 17), {
                    size: 7,
                    color: COLORS.faint,
                    width: lineWidth,
                    align: "center",
                });
            }
        });

        this.y += height;
    }

    /**
     * Statistics as KPI cards — a tinted panel per metric with an accent bar,
     * a small uppercase label and a large value. Reads at a glance in a way a
     * two-row table never did.
     */
    private drawStats(block: StatsBlock): void {
        const items = block.items;
        if (!items.length) return;

        const cols = block.columns
            ? Math.max(1, Math.min(block.columns, items.length))
            : this.fitStatColumns(items.length);
        const gap = SPACING.cardGap;
        const cardW = (this.contentWidth - gap * (cols - 1)) / cols;
        const hasNote = items.some((item) => item.note);
        const cardH = hasNote ? SPACING.cardHeight : SPACING.cardHeight - 8;

        for (let i = 0; i < items.length; i++) {
            const col = i % cols;
            if (col === 0) this.ensureSpace(cardH + gap);

            const item = items[i];
            const tone = toneStyle(item.tone);
            const x = this.x0 + col * (cardW + gap);
            const y = this.y;

            this.doc.roundedRect(x, y, cardW, cardH, SPACING.cardRadius).fill(tone.bg);
            this.doc.roundedRect(x, y + 3, 2.6, cardH - 6, 1.3).fill(tone.fg);

            const textX = x + 10;
            const textW = cardW - 16;

            this.txt(item.label.toUpperCase(), textX, y + 7, {
                size: TYPE.cardLabel,
                color: COLORS.muted,
                bold: true,
                width: textW,
                characterSpacing: 0.4,
            });
            this.txt(item.value, textX, y + 17, {
                size: TYPE.cardValue,
                bold: true,
                color: tone.fg,
                width: textW,
            });
            if (item.note) {
                this.txt(item.note, textX, y + 34, {
                    size: TYPE.cardNote,
                    color: COLORS.faint,
                    width: textW,
                });
            }

            if (col === cols - 1 || i === items.length - 1) {
                this.y += cardH + gap;
            }
        }

        this.y += SPACING.blockGap - gap;
    }

    /**
     * Pick a card grid that fills its rows.
     *
     * The widest fit is rarely the best-looking one: seven cards across five
     * columns leaves a row of two dangling under a row of five. Among the
     * widths the page can take, this prefers the one that wastes the fewest
     * slots on the final row, nudged towards more columns when it is a tie.
     */
    private fitStatColumns(count: number): number {
        const maxCols = Math.max(2, Math.min(5, Math.floor(this.contentWidth / 112)));
        const upper = Math.min(maxCols, count);
        if (upper <= 1) return 1;

        let best = upper;
        let bestScore = Infinity;
        for (let cols = upper; cols >= Math.min(3, upper); cols--) {
            const lastRow = count % cols === 0 ? cols : count % cols;
            const score = (cols - lastRow) - cols * 0.25;
            if (score < bestScore) {
                bestScore = score;
                best = cols;
            }
        }
        return best;
    }

    private drawSection(block: SectionBlock): void {
        const titleH = this.lineHeight(TYPE.sectionTitle, true);
        const subH = block.subtitle ? this.lineHeight(TYPE.sectionSubtitle) + 1 : 0;
        // Keep a section heading glued to at least a little of its content.
        this.ensureSpace(titleH + subH + 26);

        this.doc.roundedRect(this.x0, this.y + 1, 2.5, titleH - 1, 1.25).fill(COLORS.primary);
        this.txt(block.title, this.x0 + 8, this.y, {
            size: TYPE.sectionTitle,
            bold: true,
            color: COLORS.ink,
            width: this.contentWidth - 8,
        });
        this.y += titleH + 1;

        if (block.subtitle) {
            this.txt(block.subtitle, this.x0 + 8, this.y, {
                size: TYPE.sectionSubtitle,
                color: COLORS.muted,
                width: this.contentWidth - 8,
            });
            this.y += subH;
        }

        this.y += SPACING.sectionGap;
    }

    private drawText(block: TextBlock): void {
        const size = block.size ?? TYPE.note;
        const tone = block.tone ? toneStyle(block.tone).fg : COLORS.body;
        const height = this.doc
            .font(this.fontFor(block.text, block.bold))
            .fontSize(size)
            .heightOfString(block.text, { width: this.contentWidth });

        this.ensureSpace(Math.min(height, MAX_ROW_HEIGHT) + 4);
        this.txt(block.text, this.x0, this.y, {
            size,
            bold: block.bold,
            color: tone,
            width: this.contentWidth,
            align: block.align,
            lineBreak: true,
            ellipsis: false,
            height: this.contentBottom - this.y,
        });
        this.y += height + SPACING.sectionGap;
    }

    /* -------------------------------------------------------------- */
    /* Table                                                           */
    /* -------------------------------------------------------------- */

    private resolveWidths(block: TableBlock): number[] {
        const cols = block.columns;
        let fixed = 0;
        let stars = 0;
        for (const col of cols) {
            if (typeof col.width === "number") fixed += Math.max(0, col.width);
            else stars += 1;
        }

        // A column set that over-subscribes the page (easy to do when the same
        // table is reused in portrait) would otherwise leave the flexible
        // column at zero or negative width — which makes PDFKit's line
        // wrapper spin forever. Flexible columns get a floor, and the whole
        // set is then scaled to fit.
        const free = this.contentWidth - fixed;
        const starWidth = stars > 0 ? Math.max(MIN_COLUMN_WIDTH, free / stars) : 0;

        const widths = cols.map((col) =>
            typeof col.width === "number" ? Math.max(MIN_COLUMN_WIDTH, col.width) : starWidth
        );

        const total = widths.reduce((sum, w) => sum + w, 0);
        if (total > 0 && Math.abs(total - this.contentWidth) > 0.5) {
            const scale = this.contentWidth / total;
            return widths.map((w) => w * scale);
        }
        return widths;
    }

    /** Usable text width inside a cell, never below one character's worth. */
    private innerWidth(width: number): number {
        return Math.max(MIN_TEXT_WIDTH, width - CELL_PAD * 2);
    }

    private drawTableHead(block: TableBlock, widths: number[]): void {
        if (block.showHead === false) return;

        this.doc.rect(this.x0, this.y, this.contentWidth, HEAD_HEIGHT).fill(COLORS.surface);

        const textY = this.y + (HEAD_HEIGHT - this.lineHeight(TYPE.tableHead, true)) / 2;
        let x = this.x0;
        block.columns.forEach((col, i) => {
            this.txt(col.label, x + CELL_PAD, textY, {
                size: TYPE.tableHead,
                bold: true,
                color: COLORS.ink,
                width: this.innerWidth(widths[i]),
                align: col.align || "left",
            });
            x += widths[i];
        });

        this.y += HEAD_HEIGHT;
        this.rule(this.y, COLORS.borderStrong, 0.8);
    }

    private rowHeight(block: TableBlock, row: TableCell[], widths: number[], fontSize: number): number {
        const base = fontSize + 9;
        if (!block.columns.some((col) => col.wrap)) return base;

        let height = base;
        for (let i = 0; i < block.columns.length; i++) {
            if (!block.columns[i].wrap) continue;
            const cell = cellOf(row[i]);
            if (!cell.text) continue;
            const span = cell.colSpan && cell.colSpan > 1 ? cell.colSpan : 1;
            let width = 0;
            for (let s = 0; s < span && i + s < widths.length; s++) width += widths[i + s];
            const measured =
                this.doc
                    .font(this.fontFor(cell.text, cell.bold))
                    .fontSize(fontSize)
                    .heightOfString(cell.text, { width: this.innerWidth(width) }) + 8;
            if (measured > height) height = measured;
        }
        return Math.min(height, MAX_ROW_HEIGHT);
    }

    private drawRow(
        block: TableBlock,
        row: TableCell[],
        widths: number[],
        height: number,
        fontSize: number,
        options: { fill?: string; bold?: boolean; color?: string }
    ): void {
        if (options.fill) {
            this.doc.rect(this.x0, this.y, this.contentWidth, height).fill(options.fill);
        }

        let x = this.x0;
        let i = 0;
        while (i < block.columns.length) {
            const col = block.columns[i];
            const cell = cellOf(row[i]);
            const span = Math.max(1, Math.min(cell.colSpan || 1, block.columns.length - i));

            let width = 0;
            for (let s = 0; s < span; s++) width += widths[i + s];

            if (cell.text) {
                const bold = cell.bold ?? options.bold;
                const color = cell.tone ? toneStyle(cell.tone).fg : options.color || COLORS.body;
                const wrap = Boolean(col.wrap);
                const lineH = this.lineHeight(fontSize, bold);
                const textY = wrap ? this.y + 4 : this.y + (height - lineH) / 2;

                this.txt(cell.text, x + CELL_PAD, textY, {
                    size: fontSize,
                    bold,
                    color,
                    width: this.innerWidth(width),
                    align: cell.align || col.align || "left",
                    lineBreak: wrap,
                    ellipsis: !wrap,
                    height: wrap ? height - 6 : undefined,
                });
            }

            x += width;
            i += span;
        }

        this.y += height;
    }

    private drawTable(block: TableBlock): void {
        const widths = this.resolveWidths(block);
        const fontSize = block.fontSize ?? TYPE.tableBody;
        const zebra = block.zebra ?? true;
        const repeatHead = block.repeatHead ?? true;

        this.ensureSpace(HEAD_HEIGHT + fontSize + 18);
        this.drawTableHead(block, widths);

        for (let r = 0; r < block.rows.length; r++) {
            const row = block.rows[r];
            const height = this.rowHeight(block, row, widths, fontSize);

            if (this.y + height > this.contentBottom) {
                this.startPage();
                if (repeatHead) this.drawTableHead(block, widths);
            }

            const rowTone = block.rowTones?.[r];
            this.drawRow(block, row, widths, height, fontSize, {
                fill: rowTone
                    ? toneStyle(rowTone).bg
                    : zebra && r % 2 === 1
                        ? COLORS.zebra
                        : undefined,
            });
            this.rule(this.y, COLORS.border, 0.3);
        }

        if (block.totalRow) {
            const height = this.rowHeight(block, block.totalRow, widths, fontSize);
            if (this.y + height + 2 > this.contentBottom) {
                this.startPage();
                if (repeatHead) this.drawTableHead(block, widths);
            }
            this.rule(this.y, COLORS.borderStrong, 0.8);
            this.drawRow(block, block.totalRow, widths, height, fontSize, {
                fill: COLORS.surface,
                bold: true,
                color: COLORS.ink,
            });
            this.rule(this.y, COLORS.borderStrong, 0.8);
        }

        this.y += SPACING.blockGap;
    }

    /* -------------------------------------------------------------- */
    /* Entry point                                                     */
    /* -------------------------------------------------------------- */

    render(): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            this.doc.on("data", (chunk: Buffer) => chunks.push(chunk));
            this.doc.on("end", () => resolve(Buffer.concat(chunks)));
            this.doc.on("error", reject);

            try {
                this.startPage();
                for (const block of this.spec.blocks) {
                    this.drawBlock(block);
                }
                this.stampFooters();
                this.doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }
}

/** Render a report spec to a PDF buffer. Synchronous CPU work under the hood. */
export function renderReportToBuffer(spec: ReportSpec): Promise<Buffer> {
    return new ReportRenderer(spec).render();
}
