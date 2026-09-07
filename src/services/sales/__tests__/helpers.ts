import { normalizeLines } from "../sale-lines";
import { UNRESTRICTED, type CashierPolicy } from "../cashier-policy";
import type {
    ParentSaleSnapshot,
    PrepareContext,
    RawPaymentInput,
    RawSaleItemInput,
    SaleLine,
    VariantMap,
    VariantSnapshot,
} from "../types";

let nextId = 1;

/**
 * Build a variant. `factor` is the pack size (1 = unit, 12 = dozen) and is what
 * scales the product's average cost onto the variant — the variants behaviour
 * these tests must not regress.
 */
export function variant(
    overrides: Partial<VariantSnapshot> & {
        avgCostPrice?: number;
        saleBelowCost?: boolean;
        isService?: boolean;
        name?: string;
    } = {}
): VariantSnapshot {
    const id = overrides.id ?? nextId++;
    const productId = overrides.productId ?? id * 100;
    return {
        id,
        productId,
        price: overrides.price ?? 100,
        retail: overrides.retail ?? null,
        wholesale: overrides.wholesale ?? null,
        factor: overrides.factor ?? 1,
        product: {
            id: productId,
            name: overrides.name ?? overrides.product?.name ?? `Product ${productId}`,
            avgCostPrice: overrides.avgCostPrice ?? overrides.product?.avgCostPrice ?? 60,
            saleBelowCost: overrides.saleBelowCost ?? overrides.product?.saleBelowCost ?? false,
            isService: overrides.isService ?? overrides.product?.isService ?? false,
        },
    };
}

export const variantMapOf = (...variants: VariantSnapshot[]): VariantMap =>
    new Map(variants.map((v) => [v.id, v]));

/** Raw request item (what the POS screen posts). */
export const rawItem = (
    v: VariantSnapshot,
    qty: number,
    unitPrice = v.price,
    discount = 0
): RawSaleItemInput => ({ variantId: v.id, qty, unitPrice, discount });

export const linesOf = (...items: RawSaleItemInput[]): SaleLine[] => normalizeLines(items);

export const payment = (amount: number, accountId = 1): RawPaymentInput => ({ accountId, amount });

/** Original invoice a return is booked against. */
export function parentSale(args: {
    id?: number;
    totalAmount?: number;
    items: { variant: VariantSnapshot; quantity: number }[];
    returns?: { variant: VariantSnapshot; quantity: number }[][];
}): ParentSaleSnapshot {
    return {
        id: args.id ?? 1,
        totalAmount: args.totalAmount ?? 1000,
        items: args.items.map((i) => ({
            variantId: i.variant.id,
            quantity: i.quantity,
            variant: { product: { name: i.variant.product.name } },
        })),
        returns: (args.returns ?? []).map((r) => ({
            items: r.map((i) => ({ variantId: i.variant.id, quantity: i.quantity })),
        })),
    };
}

export function ctx(overrides: Partial<PrepareContext> & { lines: SaleLine[]; variantMap: VariantMap }): PrepareContext {
    return {
        parentSale: null,
        parentSaleId: null,
        customerId: null,
        userId: 7,
        note: null,
        discount: 0,
        taxAmount: 0,
        payments: [],
        // Most suites are not about till limits, so default to unrestricted.
        policy: UNRESTRICTED,
        ...overrides,
    };
}

/** A bound (non-admin) till policy for the cashier-limit suites. */
export const cashierPolicy = (over: Partial<CashierPolicy> = {}): CashierPolicy => ({
    allowPriceChange: true,
    maxDiscountPercent: null,
    exempt: false,
    ...over,
});

/** Run `fn` and return the thrown error message, or null if it did not throw. */
export function errorFrom(fn: () => unknown): string | null {
    try {
        fn();
        return null;
    } catch (e) {
        return (e as Error).message;
    }
}
