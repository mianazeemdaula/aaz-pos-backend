import { normalizeLines } from "./sale-lines";
import type { CashierPolicy } from "./cashier-policy";
import type {
    ParentSaleSnapshot,
    PrepareContext,
    RawPaymentInput,
    SaleLine,
    SaleRequestInput,
    VariantMap,
} from "./types";

/**
 * Turning an HTTP body into typed values. Everything arriving from the POS may
 * be a string ("12", "") or missing entirely, so each field is coerced once,
 * here, rather than defensively re-parsed further down.
 */

export function toNumberOrNull(v: unknown): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

export function toNumberOrZero(v: unknown): number {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
}

/** Payment legs, with nulls from a sparse client array dropped. */
export function normalizePayments(payments: SaleRequestInput["payments"]): RawPaymentInput[] {
    return (payments ?? []).filter(Boolean) as RawPaymentInput[];
}

/** Parse the request body into lines. Throws SaleError on malformed input. */
export const parseLines = (input: SaleRequestInput): SaleLine[] => normalizeLines(input.items);

/** Combine the parsed request with the data loaded for it into a prepare context. */
export function buildPrepareContext(args: {
    input: SaleRequestInput;
    lines: SaleLine[];
    variantMap: VariantMap;
    parentSale: ParentSaleSnapshot | null;
    userId: number | null;
    policy: CashierPolicy;
}): PrepareContext {
    const { input } = args;
    return {
        lines: args.lines,
        variantMap: args.variantMap,
        parentSale: args.parentSale,
        parentSaleId: toNumberOrNull(input.parentSaleId),
        customerId: toNumberOrNull(input.customerId),
        userId: args.userId,
        note: input.note != null ? String(input.note) : null,
        discount: toNumberOrZero(input.discount),
        taxAmount: toNumberOrZero(input.taxAmount),
        payments: normalizePayments(input.payments),
        policy: args.policy,
    };
}
