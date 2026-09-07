import { badRequest } from "./errors";
import { round2 } from "../../utils";
import type { SaleLine, VariantMap, VariantSnapshot } from "./types";

/**
 * Limits on what a cashier may change at the till.
 *
 * These two rules — "Allow Cashiers to Edit Unit Prices" and "Max Cashier
 * Discount Limit (%)" — were configurable on the Sales & Inventory Rules screen
 * but only the first was honoured, and only by disabling an input in the
 * browser. Anyone could post a sale directly with any price or any discount.
 * They are enforced here, on the server, for every selling line.
 *
 * Returned goods are exempt throughout: a refund pays back the price the
 * customer originally paid, which is not the cashier discounting anything.
 */

/** Settings keys, shared with the client (aaz-pos/src/hooks/useSaleSettings.ts). */
export const ALLOW_PRICE_CHANGE_KEY = "sale.allowPriceChange";
export const MAX_DISCOUNT_KEY = "maxCashierDiscount";

/** Roles that are never bound by the till limits. */
const EXEMPT_ROLES = new Set(["ADMIN"]);

export interface CashierPolicy {
    /** The cashier may type any unit price. */
    allowPriceChange: boolean;
    /** Largest discount, as a percentage of the line price. `null` = no limit. */
    maxDiscountPercent: number | null;
    /** Administrators bypass both rules. */
    exempt: boolean;
}

const asBool = (v: unknown, fallback: boolean): boolean => {
    if (v === undefined || v === null || v === "") return fallback;
    if (typeof v === "boolean") return v;
    return v === "true" || v === 1 || v === "1";
};

const asPercent = (v: unknown): number | null => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    // 100% or more is no restriction at all — treat it as unlimited so the
    // rules below can skip the work entirely.
    return n >= 100 ? null : n;
};

/**
 * Resolve the policy for one cashier.
 *
 * A per-user value overrides the global one, matching how the client resolves
 * the same keys — otherwise the till would grey out a field the API still
 * accepts, or the reverse.
 */
export function resolveCashierPolicy(args: {
    role: string | null | undefined;
    appSettings: Record<string, unknown> | null | undefined;
    userSettings?: Record<string, unknown> | null;
}): CashierPolicy {
    const app = args.appSettings ?? {};
    const user = args.userSettings ?? {};
    const pick = (key: string): unknown => (user[key] !== undefined ? user[key] : app[key]);

    return {
        allowPriceChange: asBool(pick(ALLOW_PRICE_CHANGE_KEY), true),
        maxDiscountPercent: asPercent(pick(MAX_DISCOUNT_KEY)),
        exempt: EXEMPT_ROLES.has(String(args.role ?? "")),
    };
}

/** A policy that restricts nothing — the fallback when settings cannot be read. */
export const UNRESTRICTED: CashierPolicy = {
    allowPriceChange: true,
    maxDiscountPercent: null,
    exempt: true,
};

/** Prices a variant may legitimately be sold at. */
export function allowedPrices(variant: VariantSnapshot): number[] {
    return [variant.price, variant.retail, variant.wholesale]
        .filter((p): p is number => p !== null && p !== undefined && Number.isFinite(p))
        .map(round2);
}

const sellingLines = (lines: SaleLine[]): SaleLine[] => lines.filter((l) => !l.isReturn);

/**
 * With price editing off, a line must carry one of the variant's own prices —
 * MRP, retail or wholesale. Choosing between them is picking a price list, not
 * overriding a price.
 */
export function assertPriceChangePolicy(
    lines: SaleLine[],
    variantMap: VariantMap,
    policy: CashierPolicy
): void {
    if (policy.exempt || policy.allowPriceChange) return;

    for (const line of sellingLines(lines)) {
        const variant = variantMap.get(line.variantId);
        if (!variant) continue;

        const permitted = allowedPrices(variant);
        if (!permitted.includes(round2(line.unitPrice))) {
            throw badRequest(
                `You are not allowed to change the unit price of ${variant.product.name} ` +
                `(price list: ${permitted.map((p) => p.toFixed(2)).join(" / ")}, entered: ${round2(line.unitPrice).toFixed(2)})`
            );
        }
    }
}

/** A line's discount as a percentage of its unit price. */
export function discountPercentOf(line: SaleLine): number {
    const price = round2(line.unitPrice);
    if (price <= 0) return line.discount > 0 ? 100 : 0;
    return (round2(line.discount) / price) * 100;
}

/** Net value of the selling lines before the invoice-level discount. */
export function sellingSubtotal(lines: SaleLine[]): number {
    return sellingLines(lines).reduce(
        (sum, l) => round2(sum + round2((round2(l.unitPrice) - round2(l.discount)) * l.qty)),
        0
    );
}

/**
 * Gross value of the selling lines, before any discount — the base the invoice
 * discount percentage is measured against.
 */
export function sellingGross(lines: SaleLine[]): number {
    return sellingLines(lines).reduce((sum, l) => round2(sum + round2(round2(l.unitPrice) * l.qty)), 0);
}

/** No line may be discounted past the configured percentage. */
export function assertLineDiscountLimit(
    lines: SaleLine[],
    variantMap: VariantMap,
    policy: CashierPolicy
): void {
    const limit = policy.maxDiscountPercent;
    if (policy.exempt || limit === null) return;

    for (const line of sellingLines(lines)) {
        const percent = discountPercentOf(line);
        // Rounded to two places so a 10.0000001% artefact of floating point
        // does not reject a discount the cashier entered as exactly 10%.
        if (round2(percent) > limit) {
            const name = variantMap.get(line.variantId)?.product.name ?? `variant ${line.variantId}`;
            throw badRequest(
                `Discount on ${name} is ${round2(percent).toFixed(2)}%, above your ${limit}% limit`
            );
        }
    }
}

/**
 * The invoice-level discount is capped by the same percentage, measured against
 * the gross value of the selling lines — otherwise the per-line cap could be
 * respected and then undone by one large discount at the bottom of the bill.
 */
export function assertInvoiceDiscountLimit(
    lines: SaleLine[],
    invoiceDiscount: number,
    policy: CashierPolicy
): void {
    const limit = policy.maxDiscountPercent;
    if (policy.exempt || limit === null) return;

    const discount = round2(invoiceDiscount);
    if (discount <= 0) return;

    const gross = sellingGross(lines);
    if (gross <= 0) {
        throw badRequest("An invoice discount needs at least one item to discount");
    }

    const percent = (discount / gross) * 100;
    if (round2(percent) > limit) {
        const max = round2((gross * limit) / 100);
        throw badRequest(
            `Invoice discount of Rs ${discount.toFixed(2)} is ${round2(percent).toFixed(2)}% of the bill, ` +
            `above your ${limit}% limit (maximum Rs ${max.toFixed(2)})`
        );
    }
}

/** The whole till policy for a cart. Safe to call with any cart. */
export function assertCashierPolicy(args: {
    lines: SaleLine[];
    variantMap: VariantMap;
    invoiceDiscount: number;
    policy: CashierPolicy;
}): void {
    const { lines, variantMap, invoiceDiscount, policy } = args;
    if (policy.exempt) return;
    if (sellingLines(lines).length === 0) return; // pure return — nothing was sold

    assertPriceChangePolicy(lines, variantMap, policy);
    assertLineDiscountLimit(lines, variantMap, policy);
    assertInvoiceDiscountLimit(lines, invoiceDiscount, policy);
}
