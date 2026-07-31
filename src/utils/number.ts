/**
 * Rounds a numeric value to a maximum of 2 decimal places.
 * Handles precision edge cases using Number.EPSILON.
 */
export function round2(n: number | null | undefined): number {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return 0;
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
