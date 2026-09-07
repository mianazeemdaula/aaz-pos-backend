import { round2 } from "../../utils";
import { assertSalePaymentRequirement, assertSalePricingPolicy } from "./create-sale.rules";
import { assertReturnPolicy } from "./return-sale.rules";
import { assertCashierPolicy } from "./cashier-policy";
import { classifyCart } from "./sale-lines";
import { buildItems, computeTotals } from "./sale-pricing";
import type { PrepareContext, SalePlan } from "./types";
import { badRequest } from "./errors";

/**
 * EXCHANGE — one cart holding both selling lines and return lines.
 *
 * Each half is judged by its own module's rules:
 *   • selling lines (qty > 0) → create-sale cost-price + discount policy
 *   • return lines  (qty < 0) → return-sale parent-invoice policy
 *
 * Both rule sets filter the cart themselves, so a returned item is never
 * cost-price checked and never counted against the discount allowance.
 */
export function prepareExchange(ctx: PrepareContext): SalePlan {
    const cart = classifyCart(ctx.lines);
    if (!cart.isMixed) {
        throw badRequest("prepareExchange expects a cart with both selling and return lines");
    }

    assertSalePaymentRequirement({
        hasPayments: ctx.payments.length > 0,
        customerId: ctx.customerId,
    });

    // Return half. The original invoice is optional here — a counter swap is
    // settled against the new purchase, so the cashier is not forced to produce
    // the old receipt. When one IS given the return is validated against it in
    // full. The sale half settles the refund, so no refund destination either.
    assertReturnPolicy({
        lines: ctx.lines,
        parentSale: ctx.parentSale,
        parentSaleId: ctx.parentSaleId,
        customerId: ctx.customerId,
        hasPayments: ctx.payments.length > 0,
        requireParentReference: false,
        requireRefundDestination: false,
    });

    // Sale half — cost price and discount, selling lines only.
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
        kind: "EXCHANGE",
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
