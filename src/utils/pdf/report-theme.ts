/**
 * Report design tokens.
 *
 * One place for every colour/size used by the report renderer so the whole
 * document set stays visually consistent. Values are print-friendly: light
 * fills, one accent hue, and dark ink for text.
 */

export type Tone = "default" | "primary" | "success" | "danger" | "warning" | "muted";

export const COLORS = {
    ink: "#0f172a",
    body: "#1e293b",
    muted: "#64748b",
    faint: "#94a3b8",

    primary: "#1d4ed8",
    primarySoft: "#eef4ff",
    primaryInk: "#1e3a8a",

    success: "#047857",
    successSoft: "#ecfdf5",

    danger: "#b91c1c",
    dangerSoft: "#fef2f2",

    warning: "#b45309",
    warningSoft: "#fffbeb",

    surface: "#f8fafc",
    zebra: "#fafbfc",
    border: "#e2e8f0",
    borderStrong: "#cbd5e1",
    white: "#ffffff",
} as const;

export interface ToneStyle {
    /** Accent / value colour. */
    fg: string;
    /** Card or badge background. */
    bg: string;
}

const TONES: Record<Tone, ToneStyle> = {
    default: { fg: COLORS.ink, bg: COLORS.surface },
    primary: { fg: COLORS.primary, bg: COLORS.primarySoft },
    success: { fg: COLORS.success, bg: COLORS.successSoft },
    danger: { fg: COLORS.danger, bg: COLORS.dangerSoft },
    warning: { fg: COLORS.warning, bg: COLORS.warningSoft },
    muted: { fg: COLORS.muted, bg: COLORS.surface },
};

export function toneStyle(tone: Tone = "default"): ToneStyle {
    return TONES[tone] || TONES.default;
}

/** Vertical rhythm, in points. */
export const SPACING = {
    blockGap: 10,
    sectionGap: 6,
    cardGap: 7,
    cardHeight: 44,
    cardRadius: 4,
    chipHeight: 14,
    chipGap: 5,
    chipRadius: 7,
    headerGap: 9,
    footerHeight: 18,
    footerGap: 6,
} as const;

export const TYPE = {
    title: 16,
    subtitle: 8.5,
    company: 12,
    companyMeta: 7.5,
    stamp: 7,
    chip: 7,
    sectionTitle: 10,
    sectionSubtitle: 7.5,
    cardLabel: 6.5,
    cardValue: 13,
    cardNote: 6.5,
    tableHead: 8,
    tableBody: 8,
    note: 8,
    footer: 7.5,
} as const;
