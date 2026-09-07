import { badRequest } from "./errors";
import type { CartClassification, RawSaleItemInput, SaleLine } from "./types";

/**
 * A negative quantity means the customer is giving the goods back.
 * This single predicate is the source of truth for "is this line a return?" —
 * every rule that must be skipped for returned goods keys off it.
 */
export const isReturnQty = (qty: number | string): boolean => Number(qty) < 0;

/** Parse + validate the raw request items into strongly typed lines. Throws SaleError on bad input. */
export function normalizeLines(items: RawSaleItemInput[] | undefined | null): SaleLine[] {
    if (!items?.length) throw badRequest("items are required");

    return items.map((item) => {
        if (item.variantId == null || item.qty == null || item.unitPrice == null) {
            throw badRequest("Each item must have variantId, quantity, and unitPrice");
        }

        const variantId = Number(item.variantId);
        if (!Number.isFinite(variantId)) throw badRequest("Each item must have a valid variantId");

        const qty = Number(item.qty);
        if (!Number.isFinite(qty) || qty === 0) {
            throw badRequest(`Invalid quantity for variantId ${variantId}`);
        }

        const unitPrice = Number(item.unitPrice);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
            throw badRequest(`Invalid unitPrice for variantId ${variantId}`);
        }

        const discount = Number(item.discount ?? 0);
        if (!Number.isFinite(discount)) {
            throw badRequest(`Invalid discount for variantId ${variantId}`);
        }

        return { variantId, qty, unitPrice, discount, isReturn: isReturnQty(qty) };
    });
}

/** Split a cart into its selling half and its returning half. */
export function classifyCart(lines: SaleLine[]): CartClassification {
    const saleLines = lines.filter((l) => !l.isReturn);
    const returnLines = lines.filter((l) => l.isReturn);
    const hasSaleLines = saleLines.length > 0;
    const hasReturnLines = returnLines.length > 0;

    return {
        saleLines,
        returnLines,
        hasSaleLines,
        hasReturnLines,
        isPureReturn: hasReturnLines && !hasSaleLines,
        isPureSale: hasSaleLines && !hasReturnLines,
        isMixed: hasSaleLines && hasReturnLines,
    };
}

export function cartKind(c: CartClassification): "SALE" | "RETURN" | "EXCHANGE" {
    if (c.isPureReturn) return "RETURN";
    if (c.isMixed) return "EXCHANGE";
    return "SALE";
}

/** Distinct variant ids referenced by the cart. */
export const uniqueVariantIds = (lines: SaleLine[]): number[] =>
    Array.from(new Set(lines.map((l) => l.variantId)));
