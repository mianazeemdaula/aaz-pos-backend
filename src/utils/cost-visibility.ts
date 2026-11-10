import { ADMIN_ROLE } from "../services/auth/permission-modules";

/** Fields that reveal what stock cost us, and with it the margin on a sale. */
const COST_FIELDS = new Set(["avgCostPrice"]);

/** Only administrators see cost and profit; other roles get sale data without it. */
export const canSeeCosts = (role: string | undefined): boolean => role === ADMIN_ROLE;

/**
 * A copy of an API payload with every cost field removed, however deeply it is
 * nested (sale lines, and the product attached to each line's variant).
 */
export function withoutCosts<T>(value: T): T {
    if (Array.isArray(value)) return value.map(withoutCosts) as T;
    if (value === null || typeof value !== "object" || value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (!COST_FIELDS.has(key)) out[key] = withoutCosts(v);
    }
    return out as T;
}

/** The payload as this user may see it. */
export function forRole<T>(role: string | undefined, value: T): T {
    return canSeeCosts(role) ? value : withoutCosts(value);
}
