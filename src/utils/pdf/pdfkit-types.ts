import PDFDocument from "pdfkit";

/**
 * PDFKit Component Types and Interfaces
 */

// Type alias for PDFDocument instance to use as a type annotation
export type PDFDocumentType = InstanceType<typeof PDFDocument>;

export type FontFamily = "Helvetica" | "Helvetica-Bold" | "Helvetica-Oblique" | "Times-Roman" | "Courier" | string;
export type TextAlign = "left" | "center" | "right" | "justify";
export type VerticalAlign = "top" | "center" | "bottom";

export interface PDFKitOptions {
    size?: "A4" | "A3" | "Letter" | "A5" | [number, number];
    orientation?: "portrait" | "landscape";
    margins?: {
        top: number;
        bottom: number;
        left: number;
        right: number;
    };
    bufferPages?: boolean;
    autoFirstPage?: boolean;
}

export interface FontConfig {
    family: FontFamily;
    size: number;
    color?: string;
}

export interface HeaderOptions {
    title: string;
    subtitle?: string;
    logo?: {
        path: string;
        width?: number;
        height?: number;
    };
    companyName?: string;
    address?: string;
    phone?: string;
    showDate?: boolean;
    dateFormat?: string;
    backgroundColor?: string;
    height?: number;
    font?: Partial<FontConfig>;
    titleFont?: Partial<FontConfig>;
    subtitleFont?: Partial<FontConfig>;
    filterInfo?: Record<string, string | number>;
    qrCode?: Buffer;
    qrCodeSize?: number;
}

export interface FooterOptions {
    leftText?: string;
    centerText?: string;
    rightText?: string;
    showPageNumber?: boolean;
    pageNumberFormat?: (current: number, total: number) => string;
    backgroundColor?: string;
    height?: number;
    font?: Partial<FontConfig>;
}

export interface TableColumn {
    label: string;
    key: string;
    width?: number | "*";
    align?: TextAlign;
    format?: (value: any, row?: any) => string;
    font?: Partial<FontConfig>;
}

export interface TableOptions {
    columns: TableColumn[];
    data: any[];
    showHeader?: boolean;
    headerFont?: Partial<FontConfig>;
    bodyFont?: Partial<FontConfig>;
    headerBackgroundColor?: string;
    headerTextColor?: string;
    rowHeight?: number;
    headerHeight?: number;
    alternateRowColor?: boolean;
    alternateColor?: string;
    borderColor?: string;
    borderWidth?: number;
    showTotal?: boolean;
    totalLabel?: string;
    totalColumns?: Record<string, number | string>;
    totalFont?: Partial<FontConfig>;
    totalBackgroundColor?: string;
}

export interface InfoSectionOptions {
    data: Record<string, string>;
    columns?: number;
    font?: Partial<FontConfig>;
    labelFont?: Partial<FontConfig>;
    valueFont?: Partial<FontConfig>;
    backgroundColor?: string;
    borderColor?: string;
    padding?: number;
}

export interface SignatureOptions {
    signatures: {
        label: string;
        name?: string;
        title?: string;
        showLine?: boolean;
    }[];
    spacing?: number;
    lineWidth?: number;
    font?: Partial<FontConfig>;
    labelFont?: Partial<FontConfig>;
    nameFont?: Partial<FontConfig>;
}

export interface ComponentPosition {
    x: number;
    y: number;
    width?: number;
}

export interface PDFKitComponentContext {
    doc: PDFDocumentType;
    position: ComponentPosition;
    defaultFont?: FontConfig;
    urduSupport?: boolean;
}
