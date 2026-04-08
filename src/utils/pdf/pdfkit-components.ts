import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import {
    HeaderOptions,
    FooterOptions,
    TableOptions,
    InfoSectionOptions,
    SignatureOptions,
    PDFKitComponentContext,
    FontConfig,
    PDFDocumentType,
} from "./pdfkit-types";
import fs from "fs";
import { resolveDocumentFontFamily } from "./pdfkit-fonts";

/**
 * PDFKit Components - Reusable PDF Building Blocks
 */

const DEFAULT_FONT: FontConfig = {
    family: "Helvetica",
    size: 10,
    color: "#000000",
};

/**
 * Apply font configuration to document
 */
export function applyFont(
    doc: PDFDocumentType,
    fontConfig?: Partial<FontConfig>,
    defaultFont: FontConfig = DEFAULT_FONT
): void {
    const font = { ...defaultFont, ...fontConfig };
    const resolvedFamily = resolveDocumentFontFamily(doc, font.family);
    doc.font(resolvedFamily).fontSize(font.size);
    if (font.color) {
        doc.fillColor(font.color);
    }
}

/**
 * Generate PDF Header Component
 */
export function generateHeader(
    doc: PDFDocumentType,
    options: HeaderOptions,
    context?: Partial<PDFKitComponentContext>
): number {
    const startY = context?.position?.y || doc.y;
    const startX = context?.position?.x || doc.page.margins.left;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    let yPos = startY;
    const headerStartY = yPos;

    // Background
    if (options.backgroundColor) {
        const headerHeight = options.height || 100;
        doc.rect(startX, yPos, pageWidth, headerHeight)
            .fill(options.backgroundColor);
        doc.fillColor("#000000"); // Reset color
    }

    // Calculate left side width (for logo and company info only)
    const leftSideWidth = pageWidth * 0.50;
    const rightSideWidth = pageWidth * 0.50;
    const rightSideX = startX + leftSideWidth;

    // LEFT SIDE - Logo and Company Info
    let logoYPos = yPos;
    if (options.logo && fs.existsSync(options.logo.path)) {
        const logoWidth = options.logo.width || 60;
        const logoHeight = options.logo.height || 60;
        doc.image(options.logo.path, startX, yPos, {
            width: logoWidth,
            height: logoHeight,
        });
    }

    // Company Info (next to logo)
    const contentX = options.logo ? startX + (options.logo.width || 60) + 15 : startX;
    let leftY = yPos;


    const companyName = "Dubai Mart Sweets & Bakers";
    const address = "Near Lari Ada, Depalpur";
    const phone = "0306-1073000";

    // Company Name
    if (companyName) {
        applyFont(doc, { family: "Helvetica-Bold", size: 12, color: "#000000" });
        doc.text(companyName, contentX, leftY, {
            width: leftSideWidth - (options.logo ? (options.logo.width || 60) + 15 : 0),
            align: "left",
        });
        leftY = doc.y + 2;
    }

    // Address
    if (address) {
        applyFont(doc, { family: "Helvetica", size: 8, color: "#666666" });
        doc.text(address, contentX, leftY, {
            width: leftSideWidth - (options.logo ? (options.logo.width || 60) + 15 : 0),
            align: "left",
        });
        leftY = doc.y + 2;
    }

    // Phone
    if (phone) {
        applyFont(doc, { family: "Helvetica", size: 8, color: "#666666" });
        doc.text(`Tel: ${phone}`, contentX, leftY, {
            width: leftSideWidth - (options.logo ? (options.logo.width || 60) + 15 : 0),
            align: "left",
        });
        leftY = doc.y;
    }

    // RIGHT SIDE - Title, Subtitle, Date, and Filter Info
    const rightX = rightSideX + 10;
    let rightY = headerStartY;

    // Title
    applyFont(doc, options.titleFont || { size: 8 });
    doc.text(options.title, rightX, rightY, {
        width: rightSideWidth - 15,
        align: "left",
    });
    rightY = doc.y + 3;

    // Subtitle
    if (options.subtitle) {
        applyFont(doc, options.subtitleFont || { size: 10, color: "#666666" });
        doc.text(options.subtitle, rightX, rightY, {
            width: rightSideWidth - 15,
            align: "left",
        });
        rightY = doc.y + 3;
    }

    // Date
    if (options.showDate) {
        const dateFormat = options.dateFormat || "DD MMM YYYY HH:mm";
        applyFont(doc, options.font || { size: 8, color: "#999999" });
        doc.text(`Generated: ${dayjs().format(dateFormat)}`, rightX, rightY, {
            width: rightSideWidth - 15,
            align: "left",
        });
        rightY = doc.y + 5;
    }

    // Filter Info Box (Right Side, below title/subtitle/date)
    if (options.filterInfo) {
        const filterStartY = rightY;

        // Calculate filter box height
        const filterItemHeight = 10;
        // Render filter info
        let filterX = rightX;
        const filterItemWidth = (rightSideWidth) / Object.keys(options.filterInfo).length;

        Object.entries(options.filterInfo).forEach(([label, value]) => {
            applyFont(doc, { family: "Helvetica-Bold", size: 8 });
            doc.text(label + ":", filterX, filterStartY, { continued: true });

            applyFont(doc, { family: "Helvetica", size: 8 });
            doc.text(" " + value, {});
            filterX += filterItemWidth;
        });
        rightY = filterStartY + filterItemHeight;
    }

    // Use the maximum Y position from left or right side
    yPos = Math.max(leftY, rightY);

    // Bottom border
    // yPos += 10;
    doc.moveTo(startX, yPos)
        .lineTo(startX + pageWidth, yPos)
        .stroke("#333333");

    yPos += 5;
    doc.y = yPos;

    return yPos;
}

/**
 * Generate Info Section Component
 */
export function generateInfoSection(
    doc: PDFDocumentType,
    options: InfoSectionOptions,
    context?: Partial<PDFKitComponentContext>
): number {
    const startX = context?.position?.x || doc.page.margins.left;
    const pageWidth = context?.position?.width ||
        (doc.page.width - doc.page.margins.left - doc.page.margins.right);
    let yPos = context?.position?.y || doc.y;
    const padding = options.padding || 10;

    // Background
    if (options.backgroundColor) {
        const entries = Object.entries(options.data);
        const sectionHeight = entries.length * 25 + padding * 2;
        doc.rect(startX, yPos, pageWidth, sectionHeight)
            .fillAndStroke(options.backgroundColor, options.borderColor || "#e0e0e0");
        doc.fillColor("#000000");
    }

    yPos += padding;

    // Render data
    const entries = Object.entries(options.data);
    const columns = options.columns || 2;
    const columnWidth = pageWidth / columns;

    entries.forEach(([label, value], index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const xPos = startX + col * columnWidth + padding;
        const currentY = yPos + row * 25;

        // Label
        applyFont(doc, options.labelFont || { family: "Helvetica-Bold", size: 10 });
        doc.text(label + ":", xPos, currentY, { continued: true, width: columnWidth * 0.4 });

        // Value
        applyFont(doc, options.valueFont || { family: "Helvetica", size: 8 });
        doc.text(" " + value, { width: columnWidth * 0.55 });
    });

    const rows = Math.ceil(entries.length / columns);
    yPos += rows * 25 + padding;
    doc.y = yPos;

    return yPos;
}

/**
 * Generate Table Component
 */
export function generateTable(
    doc: PDFDocumentType,
    options: TableOptions,
    context?: Partial<PDFKitComponentContext>
): number {
    const startX = context?.position?.x || doc.page.margins.left;
    const pageWidth = context?.position?.width ||
        (doc.page.width - doc.page.margins.left - doc.page.margins.right);
    let yPos = context?.position?.y || doc.y;

    const { columns, data, showHeader = true } = options;

    // Calculate column widths
    const totalStarColumns = columns.filter(col => col.width === "*" || !col.width).length;
    const fixedWidth = columns.reduce((sum, col) => {
        return sum + (typeof col.width === "number" ? col.width : 0);
    }, 0);
    const starWidth = (pageWidth - fixedWidth) / totalStarColumns;

    const columnWidths = columns.map(col => {
        if (col.width === "*" || !col.width) return starWidth;
        return col.width as number;
    });

    let columnPositions = [startX];
    for (let i = 0; i < columnWidths.length - 1; i++) {
        columnPositions.push(columnPositions[i] + columnWidths[i]);
    }

    // Header row
    if (showHeader) {
        const headerHeight = options.headerHeight || 25;

        // Header background
        if (options.headerBackgroundColor) {
            doc.rect(startX, yPos, pageWidth, headerHeight)
                .fill(options.headerBackgroundColor);
        }

        applyFont(doc, options.headerFont || { family: "Helvetica-Bold", size: 10 });
        if (options.headerTextColor) {
            doc.fillColor(options.headerTextColor);
        }

        columns.forEach((col, i) => {
            const align = col.align || "left";
            doc.text(col.label, columnPositions[i], yPos + 7, {
                width: columnWidths[i] - 10,
                align: align,
            });
        });

        yPos += headerHeight;

        // Header border
        doc.moveTo(startX, yPos)
            .lineTo(startX + pageWidth, yPos)
            .strokeColor(options.borderColor || "#000000")
            .lineWidth(options.borderWidth || 2)
            .stroke();

        yPos += 5;
    }

    // Data rows
    const rowHeight = options.rowHeight || 22;
    applyFont(doc, options.bodyFont || { family: "Helvetica", size: 9 });

    data.forEach((row, rowIndex) => {
        // Check for page break
        if (yPos > doc.page.height - doc.page.margins.bottom - 50) {
            doc.addPage();
            yPos = doc.page.margins.top;

            // Redraw header on new page
            if (showHeader) {
                const headerHeight = options.headerHeight || 25;

                if (options.headerBackgroundColor) {
                    doc.rect(startX, yPos, pageWidth, headerHeight)
                        .fill(options.headerBackgroundColor);
                }

                applyFont(doc, options.headerFont || { family: "Helvetica-Bold", size: 10 });
                if (options.headerTextColor) {
                    doc.fillColor(options.headerTextColor);
                }

                columns.forEach((col, i) => {
                    doc.text(col.label, columnPositions[i], yPos + 7, {
                        width: columnWidths[i] - 10,
                        align: col.align || "left",
                    });
                });

                yPos += headerHeight;
                doc.moveTo(startX, yPos)
                    .lineTo(startX + pageWidth, yPos)
                    .strokeColor(options.borderColor || "#000000")
                    .lineWidth(options.borderWidth || 2)
                    .stroke();

                yPos += 5;
            }
        }

        // Alternate row background
        if (options.alternateRowColor && rowIndex % 2 === 1) {
            doc.rect(startX, yPos, pageWidth, rowHeight)
                .fill(options.alternateColor || "#f9f9f9");
        }

        doc.fillColor("#000000");
        applyFont(doc, options.bodyFont || { family: "Helvetica", size: 9 });

        // Render cells
        columns.forEach((col, i) => {
            const value = row[col.key];
            const displayValue = col.format ? col.format(value, row) : (value?.toString() || "");

            if (col.font) {
                applyFont(doc, col.font);
            }

            doc.text(displayValue, columnPositions[i] + 5, yPos + 5, {
                width: columnWidths[i] - 10,
                align: col.align || "left",
                lineBreak: false,
            });
        });

        yPos += rowHeight;

        // Row border
        doc.moveTo(startX, yPos)
            .lineTo(startX + pageWidth, yPos)
            .strokeColor(options.borderColor || "#cccccc")
            .lineWidth(0.5)
            .stroke();
    });

    // Total row
    if (options.showTotal && options.totalColumns) {
        yPos += 5;

        if (options.totalBackgroundColor) {
            doc.rect(startX, yPos, pageWidth, rowHeight)
                .fill(options.totalBackgroundColor);
        }

        applyFont(doc, options.totalFont || { family: "Helvetica-Bold", size: 10 });
        doc.fillColor("#000000");

        columns.forEach((col, i) => {
            let displayValue = "";

            if (col.key in options.totalColumns!) {
                const totalValue = options.totalColumns![col.key];
                displayValue = typeof totalValue === "number"
                    ? totalValue.toLocaleString()
                    : totalValue;
            } else if (i === 0 && options.totalLabel) {
                displayValue = options.totalLabel;
            }

            if (displayValue) {
                doc.text(displayValue, columnPositions[i] + 5, yPos + 5, {
                    width: columnWidths[i] - 10,
                    align: col.align || "left",
                });
            }
        });

        yPos += rowHeight;

        // Total border
        doc.moveTo(startX, yPos)
            .lineTo(startX + pageWidth, yPos)
            .strokeColor(options.borderColor || "#000000")
            .lineWidth(2)
            .stroke();
    }

    yPos += 10;
    doc.y = yPos;

    return yPos;
}

/**
 * Generate Footer Component (called for each page)
 */
export function generateFooter(
    doc: PDFDocumentType,
    options: FooterOptions,
    pageNumber: number,
    totalPages: number
): void {
    // Save current position
    const savedY = doc.y;
    const savedX = doc.x;

    const startX = doc.page.margins.left;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const footerY = doc.page.height - doc.page.margins.bottom - (options.height || 20);
    const footerHeight = options.height || 20;

    // Background
    if (options.backgroundColor) {
        doc.rect(startX, footerY, pageWidth, footerHeight)
            .fill(options.backgroundColor);
        doc.fillColor("#000000");
    }

    // Top border
    doc.moveTo(startX, footerY)
        .lineTo(startX + pageWidth, footerY)
        .stroke("#cccccc");

    const textY = footerY + 10;
    applyFont(doc, options.font || { size: 8, color: "#666666" });

    // Left text
    if (options.leftText) {
        doc.text(options.leftText, startX, textY, {
            width: pageWidth / 3 - 10,
            align: "left",
            lineBreak: false,
        });
    }

    // Center text with page number
    const centerText = options.centerText || "";
    let pageNumberText = "";

    if (options.showPageNumber) {
        pageNumberText = options.pageNumberFormat
            ? options.pageNumberFormat(pageNumber, totalPages)
            : `Page ${pageNumber} of ${totalPages}`;
    }

    const fullCenterText = centerText + (centerText && pageNumberText ? " | " : "") + pageNumberText;

    doc.text(fullCenterText, startX + pageWidth / 3, textY, {
        width: pageWidth / 3 - 10,
        align: "center",
        lineBreak: false,
    });

    // Right text
    const rightText = options.rightText || dayjs().format("DD MMM YYYY");
    doc.text(rightText, startX + (2 * pageWidth) / 3, textY, {
        width: pageWidth / 3 - 10,
        align: "right",
        lineBreak: false,
    });

    // Restore position to prevent page breaks
    doc.x = savedX;
    doc.y = savedY;
}

/**
 * Generate Signature Section Component
 */
export function generateSignatureSection(
    doc: PDFDocumentType,
    options: SignatureOptions,
    context?: Partial<PDFKitComponentContext>
): number {
    const startX = context?.position?.x || doc.page.margins.left;
    const pageWidth = context?.position?.width ||
        (doc.page.width - doc.page.margins.left - doc.page.margins.right);
    let yPos = context?.position?.y || doc.y;

    const signatureCount = options.signatures.length;
    const spacing = options.spacing || 30;
    const lineWidth = options.lineWidth || 100;
    const signatureWidth = pageWidth / signatureCount;

    // Add some space before signatures
    yPos += 20;

    options.signatures.forEach((signature, index) => {
        const xPos = startX + (index * signatureWidth) + (signatureWidth - lineWidth) / 2;

        // Signature line
        if (signature.showLine !== false) {
            doc.moveTo(xPos, yPos)
                .lineTo(xPos + lineWidth, yPos)
                .stroke("#000000");
        }

        // Label (e.g., "Prepared By", "Approved By")
        applyFont(doc, options.labelFont || { family: "Helvetica-Bold", size: 9 });
        doc.text(signature.label, xPos, yPos + 5, {
            width: lineWidth,
            align: "center",
            lineBreak: false,
        });

        // Name
        if (signature.name) {
            applyFont(doc, options.nameFont || { family: "Helvetica", size: 10 });
            doc.text(signature.name, xPos, yPos + 18, {
                width: lineWidth,
                align: "center",
                lineBreak: false,
            });
        }

        // Title
        if (signature.title) {
            applyFont(doc, options.font || { family: "Helvetica", size: 8, color: "#666666" });
            doc.text(signature.title, xPos, yPos + (signature.name ? 31 : 18), {
                width: lineWidth,
                align: "center",
                lineBreak: false,
            });
        }
    });

    // Calculate the final Y position
    const maxHeight = options.signatures.some(s => s.name && s.title) ? 50 :
        options.signatures.some(s => s.name || s.title) ? 35 : 20;
    yPos += maxHeight;

    doc.y = yPos;
    return yPos;
}
