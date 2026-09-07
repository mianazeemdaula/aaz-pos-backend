import { badRequest } from "./errors";
import type { SaleLine, VariantMap } from "./types";

/**
 * Cost-price and discount policy for OUTGOING goods.
 *
 * Every rule in this file is deliberately scoped to selling lines (qty > 0).
 * Returned goods (qty < 0) are money flowing back to the customer at whatever
 * price they originally paid — refunding below today's average cost is not a
 * discount and must never be blocked. Each function therefore filters return
 * lines out itself, so a mixed "exchange" cart can be passed in wholesale
 * without leaking a return line into a cost-price check.
 */

export const sellingLinesOnly = (lines: SaleLine[]): SaleLine[] => lines.filter((l) => !l.isReturn);

/** Effective per-unit price after the line discount. */
export const netUnitPrice = (line: SaleLine): number => line.unitPrice - line.discount;

/** Average cost for one unit of this variant (product cost scaled by the pack factor). */
export const variantUnitCost = (variant: { factor: number; product: { avgCostPrice: number } }): number =>
    (variant.product.avgCostPrice ?? 0) * variant.factor;

/**
 * Per-line guard: a discount may not push the price below zero, nor below the
 * variant's cost unless the product explicitly allows selling below cost.
 * Return lines are skipped.
 */
export function assertLineDiscountWithinCost(lines: SaleLine[], variantMap: VariantMap): void {
    for (const line of sellingLinesOnly(lines)) {
        const variant = variantMap.get(line.variantId);
        if (!variant) throw badRequest(`Variant ID ${line.variantId} not found`);

        const net = netUnitPrice(line);
        if (net < 0) {
            throw badRequest(`Discount cannot be more than the selling price for ${variant.product.name}`);
        }

        const cost = variantUnitCost(variant);
        if (!variant.product.saleBelowCost && net < cost) {
            throw badRequest(
                `Discount cannot make selling price below cost price for ${variant.product.name} ` +
                `(Cost: Rs ${cost.toFixed(2)}, Discounted Price: Rs ${net.toFixed(2)})`
            );
        }
    }
}

/**
 * The invoice-level discount may not eat more than the margin above cost of the
 * items that are not flagged saleBelowCost. Only selling lines contribute — a
 * return line would otherwise subtract its cost from the allowance and wrongly
 * shrink (or invert) the permitted discount.
 *
 * Returns `null` when there is no applicable limit (pure return cart, or every
 * item allows selling below cost).
 */
export function maxInvoiceDiscount(lines: SaleLine[], variantMap: VariantMap): number | null {
    let totalCost = 0;
    let totalNet = 0;
    let applicable = false;

    for (const line of sellingLinesOnly(lines)) {
        const variant = variantMap.get(line.variantId);
        if (!variant || variant.product.saleBelowCost) continue;

        totalCost += variantUnitCost(variant) * line.qty;
        totalNet += netUnitPrice(line) * line.qty;
        applicable = true;
    }

    return applicable ? totalNet - totalCost : null;
}

/** Guard for the invoice-level discount. No-op when no limit applies. */
export function assertInvoiceDiscountWithinMargin(
    lines: SaleLine[],
    variantMap: VariantMap,
    discount: number
): void {
    const limit = maxInvoiceDiscount(lines, variantMap);
    if (limit === null) return;

    if (Number(discount) > limit) {
        throw badRequest(
            `Overall invoice discount cannot exceed Rs ${limit.toFixed(2)} ` +
            `(the margin above cost price for non-sale-below-cost items)`
        );
    }
}

/**
 * Full cost-price + discount policy for a cart. Safe to call with any cart:
 * a pure-return cart has no selling lines, so nothing is checked at all.
 */
export function assertSalePricingPolicy(args: {
    lines: SaleLine[];
    variantMap: VariantMap;
    discount: number;
}): void {
    const selling = sellingLinesOnly(args.lines);
    if (selling.length === 0) return; // pure return — no cost price, no discount checks

    assertLineDiscountWithinCost(selling, args.variantMap);
    assertInvoiceDiscountWithinMargin(selling, args.variantMap, args.discount);
}

/** Payment/customer requirement for a cart that contains selling lines. */
export function assertSalePaymentRequirement(args: {
    hasPayments: boolean;
    customerId: number | null;
}): void {
    if (!args.hasPayments && !args.customerId) {
        throw badRequest("payments or customerId is required for sales");
    }
}
