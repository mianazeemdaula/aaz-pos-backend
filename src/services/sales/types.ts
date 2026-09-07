import type { CashierPolicy } from "./cashier-policy";

/** Shared types for the sales / return pipeline. */

export interface RawSaleItemInput {
    variantId: number | string;
    qty: number | string;
    unitPrice: number | string;
    discount?: number | string | null;
    [k: string]: unknown;
}

export interface RawPaymentInput {
    accountId: number;
    amount: number | string;
    note?: string | null;
    [k: string]: unknown;
}

export interface SaleRequestInput {
    customerId?: number | string | null;
    items: RawSaleItemInput[];
    payments?: RawPaymentInput[] | null;
    discount?: number | string | null;
    taxAmount?: number | string | null;
    parentSaleId?: number | string | null;
    note?: string | null;
}

/** An item line after parsing/validation. `qty < 0` means the line is a return. */
export interface SaleLine {
    variantId: number;
    qty: number;
    unitPrice: number;
    /** Per-unit discount amount (already resolved to currency by the caller). */
    discount: number;
    isReturn: boolean;
}

/** Minimal shape of a product variant the rules need. Keeps rules DB-agnostic (and testable). */
export interface VariantSnapshot {
    id: number;
    productId: number;
    price: number;
    /** Alternate price lists a cashier may pick without "editing" the price. */
    retail?: number | null;
    wholesale?: number | null;
    factor: number;
    product: {
        id: number;
        name: string;
        avgCostPrice: number;
        saleBelowCost: boolean;
        /** Services carry no inventory — selling one must not move stock. */
        isService: boolean;
    };
}

export type VariantMap = Map<number, VariantSnapshot>;

/** Minimal shape of the original sale a return is booked against. */
export interface ParentSaleSnapshot {
    id: number;
    totalAmount: number;
    items: { variantId: number; quantity: number; variant: { product: { name: string } } }[];
    returns: { items: { variantId: number; quantity: number }[] }[];
}

export interface CartClassification {
    /** Lines with qty > 0 — real selling lines. Cost-price / discount rules apply here only. */
    saleLines: SaleLine[];
    /** Lines with qty < 0 — returned goods. Never cost-price or discount checked. */
    returnLines: SaleLine[];
    hasSaleLines: boolean;
    hasReturnLines: boolean;
    /** Every line is a return. */
    isPureReturn: boolean;
    /** Every line is a sale. */
    isPureSale: boolean;
    /** Both kinds present in one cart (exchange). */
    isMixed: boolean;
}

export interface PreparedPayment {
    accountId: number;
    amount: number;
    changeAmount: number;
    note?: string | null;
}

export interface PreparedItem {
    variantId: number;
    quantity: number;
    unitPrice: number;
    discount: number;
    totalPrice: number;
    avgCostPrice: number;
}

export interface SaleTotals {
    totalAmount: number;
    paidAmount: number;
    changeAmount: number;
    netPaidAmount: number;
    payments: PreparedPayment[];
}

/** Everything needed to write the transaction — produced by the prepare step, consumed by the repository. */
export interface SalePlan {
    kind: "SALE" | "RETURN" | "EXCHANGE";
    customerId: number | null;
    userId: number | null;
    parentSaleId: number | null;
    note: string | null;
    discount: number;
    taxAmount: number;
    totals: SaleTotals;
    items: PreparedItem[];
    lines: SaleLine[];
    variantMap: VariantMap;
}

/** Everything the pure prepare-step needs. Deliberately free of Prisma types so it can be unit tested. */
export interface PrepareContext {
    lines: SaleLine[];
    variantMap: VariantMap;
    parentSale: ParentSaleSnapshot | null;
    parentSaleId: number | null;
    customerId: number | null;
    userId: number | null;
    note: string | null;
    discount: number;
    taxAmount: number;
    payments: RawPaymentInput[];
    /** Till limits for the user posting this sale. */
    policy: CashierPolicy;
}
