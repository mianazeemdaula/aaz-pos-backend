import { badRequest } from "./errors";
import type { ParentSaleSnapshot, SaleLine } from "./types";

/**
 * Policy for INCOMING goods (qty < 0).
 *
 * Returns are validated against the original invoice only: the item must have
 * been on it, and the quantity coming back may not exceed what is still
 * outstanding after earlier returns. Cost price and discount limits are
 * intentionally absent here — see create-sale.rules.ts.
 */

export const returnLinesOnly = (lines: SaleLine[]): SaleLine[] => lines.filter((l) => l.isReturn);

/** Units of a variant already returned against the original sale. */
export function alreadyReturnedQty(parentSale: ParentSaleSnapshot, variantId: number): number {
    let total = 0;
    for (const priorReturn of parentSale.returns ?? []) {
        for (const priorItem of priorReturn.items ?? []) {
            if (priorItem.variantId === variantId) total += Math.abs(priorItem.quantity);
        }
    }
    return total;
}

/** Units of a variant still returnable on the original sale. */
export function remainingReturnableQty(parentSale: ParentSaleSnapshot, variantId: number): number {
    const sold = (parentSale.items ?? [])
        .filter((i) => i.variantId === variantId)
        .reduce((sum, i) => sum + i.quantity, 0);
    return sold - alreadyReturnedQty(parentSale, variantId);
}

export function assertParentSaleIsReturnable(parentSale: ParentSaleSnapshot | null): asserts parentSale {
    if (!parentSale) throw badRequest("Original sale not found");
    if (parentSale.totalAmount < 0) {
        throw badRequest("Cannot create a return against a return transaction");
    }
}

/** A cart that gives goods back must say which invoice they came from. */
export function assertParentSaleReference(parentSaleId: number | null): asserts parentSaleId is number {
    if (!parentSaleId) {
        throw badRequest("Original sale reference (parentSaleId) is required for returns");
    }
}

/**
 * A walk-in (no customer) return has nowhere to book the refund unless a
 * payment account is supplied.
 */
export function assertRefundDestination(args: { customerId: number | null; hasPayments: boolean }): void {
    if (!args.customerId && !args.hasPayments) {
        throw badRequest("Refund payment account is required for walking customer returns");
    }
}

/**
 * Validate the returning half of a cart against the original invoice.
 * Only return lines are inspected, so an exchange cart can be passed whole.
 */
export function assertReturnableAgainstParent(lines: SaleLine[], parentSale: ParentSaleSnapshot): void {
    for (const line of returnLinesOnly(lines)) {
        const parentItem = (parentSale.items ?? []).find((i) => i.variantId === line.variantId);
        if (!parentItem) {
            throw badRequest(
                `Variant ID ${line.variantId} was not purchased in the original sale #${parentSale.id}`
            );
        }

        const alreadyReturned = alreadyReturnedQty(parentSale, line.variantId);
        const remaining = remainingReturnableQty(parentSale, line.variantId);
        const requested = Math.abs(line.qty);

        if (requested > remaining) {
            throw badRequest(
                `Cannot return ${requested} units of ${parentItem.variant.product.name}. ` +
                `Max returnable quantity is ${remaining} ` +
                `(Original: ${parentItem.quantity}, Already returned: ${alreadyReturned})`
            );
        }
    }
}

/** Full return policy for a cart. No-op when the cart contains no return lines. */
export function assertReturnPolicy(args: {
    lines: SaleLine[];
    parentSale: ParentSaleSnapshot | null;
    parentSaleId: number | null;
    customerId: number | null;
    hasPayments: boolean;
    /**
     * Standalone refunds must cite the invoice they reverse — that is the only
     * record of what was sold and how much of it is still returnable.
     * An exchange does not: the goods are swapped at the counter and the refund
     * is settled against the new purchase in the same transaction, so the
     * cashier may not have the original receipt to hand.
     */
    requireParentReference: boolean;
    /** Pure-return carts need a refund destination; exchanges settle against the sale half. */
    requireRefundDestination: boolean;
}): void {
    if (returnLinesOnly(args.lines).length === 0) return;

    if (args.requireParentReference) assertParentSaleReference(args.parentSaleId);
    if (args.requireRefundDestination) {
        assertRefundDestination({ customerId: args.customerId, hasPayments: args.hasPayments });
    }

    // Whenever an invoice IS cited the return is checked against it in full,
    // whether it was mandatory or the cashier supplied it voluntarily.
    if (args.parentSaleId != null) {
        assertParentSaleIsReturnable(args.parentSale);
        assertReturnableAgainstParent(args.lines, args.parentSale);
    }
}
