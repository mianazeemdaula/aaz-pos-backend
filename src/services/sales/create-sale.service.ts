import { round2 } from "../../utils";
import { assertSalePaymentRequirement, assertSalePricingPolicy } from "./create-sale.rules";
import { assertCashierPolicy } from "./cashier-policy";
import { classifyCart } from "./sale-lines";
import { buildItems, computeTotals } from "./sale-pricing";
import type { PrepareContext, SalePlan } from "./types";
import { badRequest } from "./errors";

/**
 * CREATE SALE — goods going out.
 *
 * Owns everything specific to selling: the payment/customer requirement and
 * the cost-price + discount policy. Nothing here runs against a return line.
 */
export function prepareCreateSale(ctx: PrepareContext): SalePlan {
    const cart = classifyCart(ctx.lines);
    if (cart.hasReturnLines) {
        throw badRequest("prepareCreateSale received a return line; route the cart through prepareReturnSale");
    }

    assertSalePaymentRequirement({
        hasPayments: ctx.payments.length > 0,
        customerId: ctx.customerId,
    });

    assertSalePricingPolicy({
        lines: ctx.lines,
        variantMap: ctx.variantMap,
        discount: ctx.discount,
    });

    // What this cashier is allowed to change at the till — price overrides and
    // the discount ceiling. Enforced here rather than only in the browser.
    assertCashierPolicy({
        lines: ctx.lines,
        variantMap: ctx.variantMap,
        invoiceDiscount: ctx.discount,
        policy: ctx.policy,
    });

    return {
        kind: "SALE",
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
            allowChange: true,
        }),
        items: buildItems(ctx.lines, ctx.variantMap),
        lines: ctx.lines,
        variantMap: ctx.variantMap,
    };
}
