import type { SalePlan, VariantSnapshot } from "./types";

/**
 * The side effects a sale plan implies, derived as plain data so their
 * direction can be asserted in tests without a database.
 */

export interface StockPosting {
    productId: number;
    type: "SALE" | "SALE_RETURN";
    /** Positive = stock coming back in, negative = stock going out. */
    quantity: number;
    /** Signed amount to subtract from Product.totalStock. */
    decrementBy: number;
    referencePrefix: "INV" | "RTN";
}

export interface LedgerPosting {
    customerId: number;
    type: "SALE" | "SALE_RETURN";
    amount: number;
    debit: number;
    credit: number;
    message: string;
}

/**
 * A service has nothing to take off a shelf, so it neither moves totalStock nor
 * earns a StockMovement row — a movement that never reaches totalStock would
 * put the stock ledger permanently out of balance with the product record.
 * This holds in both directions: selling a service takes no stock out, and
 * returning one puts none back.
 */
export const tracksInventory = (variant: VariantSnapshot): boolean => !variant.product.isService;

/** One posting per stock-carrying cart line, in cart order. Service lines are skipped. */
export function stockPostings(plan: SalePlan): StockPosting[] {
    const postings: StockPosting[] = [];

    for (const line of plan.lines) {
        const variant = plan.variantMap.get(line.variantId)!;
        if (!tracksInventory(variant)) continue;

        const movedQty = line.qty * variant.factor;
        postings.push({
            productId: variant.productId,
            type: line.isReturn ? "SALE_RETURN" : "SALE",
            quantity: -movedQty,
            decrementBy: movedQty,
            referencePrefix: line.isReturn ? "RTN" : "INV",
        });
    }

    return postings;
}

/**
 * The customer ledger entry, or null when there is no customer or nothing
 * outstanding. A negative amount due is money owed back to the customer.
 */
export function ledgerPosting(plan: SalePlan, saleId: number): LedgerPosting | null {
    if (!plan.customerId) return null;

    const amountDue = plan.totals.totalAmount - plan.totals.netPaidAmount;
    if (amountDue === 0) return null;

    const isCredit = amountDue < 0;
    return {
        customerId: plan.customerId,
        type: isCredit ? "SALE_RETURN" : "SALE",
        amount: Math.abs(amountDue),
        debit: isCredit ? 0 : Math.abs(amountDue),
        credit: isCredit ? Math.abs(amountDue) : 0,
        message: isCredit
            ? `Customer returned items worth Rs ${Math.abs(amountDue)}`
            : `Bill amount Rs ${plan.totals.totalAmount} with payments Rs ${plan.totals.netPaidAmount} Invoice # ${saleId}`,
    };
}
