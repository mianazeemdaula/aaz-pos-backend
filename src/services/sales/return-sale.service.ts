import { round2 } from "../../utils";
import { assertReturnPolicy } from "./return-sale.rules";
import { classifyCart } from "./sale-lines";
import { buildItems, computeTotals } from "./sale-pricing";
import type { PrepareContext, SalePlan } from "./types";
import { badRequest } from "./errors";

/**
 * RETURN SALE — goods coming back.
 *
 * Owns everything specific to refunds: the parent-invoice reference, the
 * returnable-quantity ceiling and the refund destination.
 *
 * It deliberately does NOT import the cost-price or discount rules. A refund is
 * paid at the price the customer originally paid; comparing it to today's
 * average cost, or capping it by a discount allowance, would reject legitimate
 * returns.
 */
export function prepareReturnSale(ctx: PrepareContext): SalePlan {
    const cart = classifyCart(ctx.lines);
    if (cart.hasSaleLines) {
        throw badRequest("prepareReturnSale received a selling line; route the cart through prepareExchange");
    }

    assertReturnPolicy({
        lines: ctx.lines,
        parentSale: ctx.parentSale,
        parentSaleId: ctx.parentSaleId,
        customerId: ctx.customerId,
        hasPayments: ctx.payments.length > 0,
        requireParentReference: true,
        requireRefundDestination: true,
    });

    return {
        kind: "RETURN",
        customerId: ctx.customerId,
        userId: ctx.userId,
        parentSaleId: ctx.parentSaleId,
        note: ctx.note,
        discount: round2(ctx.discount),
        taxAmount: round2(ctx.taxAmount),
        totals: computeTotals({
            lines: ctx.lines,
            discount: ctx.discount,
            taxAmount: ctx.taxAmount,
            payments: ctx.payments,
            // A refund leg is money going out; there is no change to hand back.
            allowChange: false,
        }),
        items: buildItems(ctx.lines, ctx.variantMap),
        lines: ctx.lines,
        variantMap: ctx.variantMap,
    };
}
