import PDFDocument from "pdfkit";
import { Response } from "express";
import { PDFKitOptions, HeaderOptions, FooterOptions, PDFDocumentType } from "./pdfkit-types";
import { generateHeader, generateFooter } from "./pdfkit-components";
import fs from "fs";
import path from "path";
import {
    FontDefinition,
    applyDocumentFontAliases,
    getReportFontTheme,
    patchDocumentTextForUrdu,
    setDocumentUrduFontFamily,
} from "./pdfkit-fonts";

/**
 * PDFKit Document Generator with Header/Footer Support
 */

export interface PDFGeneratorConfig {
    pdfOptions?: PDFKitOptions;
    header?: HeaderOptions;
    footer?: FooterOptions;
    fontRegistrations?: FontDefinition[];
    fontFamilyMap?: Record<string, string>;
    urduTextFontFamily?: string;
    urduFont?: {
        path: string;
        family: string;
    };
}

export class PDFKitGenerator {
    private doc: PDFDocumentType;
    private config: PDFGeneratorConfig;
    private contentStartY: number = 0;
    private contentEndY: number = 0;
    private pageNumbers: number[] = [];

    constructor(config: PDFGeneratorConfig = {}) {
        this.config = config;

        const pdfOptions = {
            size: config.pdfOptions?.size || "A4",
            margins: config.pdfOptions?.margins || {
                top: config.header ? 120 : 50,
                bottom: config.footer ? 80 : 50,
                left: 50,
                right: 50,
            },
            bufferPages: true,
            layout: config.pdfOptions?.orientation || "portrait",
            autoFirstPage: false,
            ...config.pdfOptions,
        };

        this.doc = new PDFDocument(pdfOptions);
        const reportFontTheme = getReportFontTheme();

        // Add first page manually
        this.doc.addPage();

        // Register Urdu font if provided
        if (config.urduFont && fs.existsSync(config.urduFont.path)) {
            this.doc.registerFont(config.urduFont.family, config.urduFont.path);
        }

        // Register additional theme fonts if provided
        if (config.fontRegistrations && config.fontRegistrations.length > 0) {
            config.fontRegistrations.forEach((font) => {
                if (font.family && fs.existsSync(font.path)) {
                    this.doc.registerFont(font.family, font.path);
                }
            });
        }

        const hasAppUrduRegistration = Boolean(
            config.fontRegistrations?.some((font) => font.family === "App-Urdu-Regular")
        );
        if (!hasAppUrduRegistration && reportFontTheme.urduRegular) {
            reportFontTheme.registrations
                .filter((font) => font.family === "App-Urdu-Regular" || font.family === "App-Urdu-Bold")
                .forEach((font) => {
                    if (font.family && fs.existsSync(font.path)) {
                        this.doc.registerFont(font.family, font.path);
                    }
                });
        }

        // Apply font alias mapping (e.g., Helvetica -> App-Regular)
        if (config.fontFamilyMap && Object.keys(config.fontFamilyMap).length > 0) {
            applyDocumentFontAliases(this.doc, config.fontFamilyMap);
        }

        const urduTextFontFamily =
            config.urduTextFontFamily ||
            reportFontTheme.urduRegular ||
            config.urduFont?.family;

        if (urduTextFontFamily) {
            setDocumentUrduFontFamily(this.doc, urduTextFontFamily);
            patchDocumentTextForUrdu(this.doc);
        }

        // Calculate content area
        this.contentStartY = this.doc.page.margins.top;
        this.contentEndY = this.doc.page.height - this.doc.page.margins.bottom;

        // Draw header on first page if configured
        if (config.header) {
            this.contentStartY = generateHeader(this.doc, config.header);
            // Update margins.top so PDFKit's native table knows the real content start Y.
            // The table captures doc.page.margins.top when calculating row positions on page breaks.
            this.doc.page.margins.top = this.contentStartY;
        }

        // Listen for page events to add headers/footers
        this.setupPageEvents();
    }

    /**
     * Setup page event listeners for automatic header/footer
     */
    private setupPageEvents(): void {
        // Store the original physical top margin so the header always renders from the top.
        const physicalTopMargin = this.config.pdfOptions?.margins?.top ?? this.doc.page.margins.top;

        this.doc.on("pageAdded", () => {
            const currentPage = this.doc.bufferedPageRange().count;

            // Add header on new page (page 1 is handled in the constructor)
            if (this.config.header && currentPage > 1) {
                // Start from the physical top of the new page (PDFKit already set doc.y = margins.top,
                // but margins.top may have been updated to the post-header value on the previous page).
                this.doc.y = physicalTopMargin;

                // Draw the header and get the Y position where body content should begin.
                const contentStartY = generateHeader(this.doc, this.config.header);

                // Move the cursor to just below the header.
                this.doc.y = contentStartY;

                // Update this page's top margin so PDFKit's built-in table correctly
                // positions the first row after a page break (it reads doc.page.margins.top).
                this.doc.page.margins.top = contentStartY;
            }
        });
    }

    /**
     * Get the PDFDocument instance
     */
    getDocument(): PDFDocumentType {
        return this.doc;
    }

    /**
     * Get current Y position
     */
    getY(): number {
        return this.doc.y;
    }

    /**
     * Set Y position
     */
    setY(y: number): void {
        this.doc.y = y;
    }

    /**
     * Move to next line
     */
    moveDown(lines: number = 1): PDFKitGenerator {
        this.doc.moveDown(lines);
        return this;
    }

    /**
     * Add custom content via callback
     */
    addContent(callback: (doc: PDFDocumentType) => void): PDFKitGenerator {
        callback(this.doc);
        return this;
    }

    /**
     * Add page break
     */
    addPage(): PDFKitGenerator {
        this.doc.addPage();
        return this;
    }

    /**
     * Finalize and send PDF to response
     */
    async sendToResponse(res: Response, filename: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // Add footers to all pages before finalizing
                if (this.config.footer) {
                    const range = this.doc.bufferedPageRange();
                    const totalPages = range.count;
                    console.log(`Total pages: ${totalPages}`);
                    for (let i = 0; i < totalPages; i++) {
                        this.doc.switchToPage(i);
                        generateFooter(this.doc, this.config.footer, i + 1, totalPages);
                    }
                }

                // Set response headers
                res.setHeader("Content-Type", "application/pdf");
                res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

                // Pipe to response
                this.doc.pipe(res);

                // Finalize
                this.doc.end();

                this.doc.on("end", () => {
                    resolve();
                });

                this.doc.on("error", (err: Error) => {
                    reject(err);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Finalize and get buffer
     */
    async toBuffer(): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            // Add footers to all pages before finalizing
            if (this.config.footer) {
                const range = this.doc.bufferedPageRange();
                const totalPages = range.count;

                for (let i = 0; i < totalPages; i++) {
                    this.doc.switchToPage(i);
                    generateFooter(this.doc, this.config.footer, i + 1, totalPages);
                }
            }

            const chunks: Buffer[] = [];

            this.doc.on("data", (chunk: Buffer) => {
                chunks.push(chunk);
            });

            this.doc.on("end", () => {
                resolve(Buffer.concat(chunks));
            });

            this.doc.on("error", (err: Error) => {
                reject(err);
            });

            this.doc.end();
        });
    }

    /**
     * Save to file
     */
    async saveToFile(filePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // Add footers to all pages before finalizing
            if (this.config.footer) {
                const range = this.doc.bufferedPageRange();
                const totalPages = range.count;

                for (let i = 0; i < totalPages; i++) {
                    this.doc.switchToPage(i);
                    generateFooter(this.doc, this.config.footer, i + 1, totalPages);
                }
            }

            const stream = fs.createWriteStream(filePath);

            this.doc.pipe(stream);
            this.doc.end();

            stream.on("finish", () => {
                resolve();
            });

            stream.on("error", (err) => {
                reject(err);
            });
        });
    }

    /**
     * Check if we need a page break
     */
    needsPageBreak(requiredSpace: number = 50): boolean {
        return this.doc.y + requiredSpace > this.contentEndY;
    }

    /**
     * Get content area dimensions
     */
    getContentArea(): { x: number; y: number; width: number; height: number } {
        return {
            x: this.doc.page.margins.left,
            y: this.contentStartY,
            width: this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right,
            height: this.contentEndY - this.contentStartY,
        };
    }
}

/**
 * Helper function to create a new PDF generator
 */
export function createPDFGenerator(config: PDFGeneratorConfig = {}): PDFKitGenerator {
    return new PDFKitGenerator(config);
}
