import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prepareExchange } from "../exchange-sale.service";
import { prepareSalePlan } from "../sales.service";
import { maxInvoiceDiscount, sellingLinesOnly } from "../create-sale.rules";
import { returnLinesOnly } from "../return-sale.rules";
import { ctx, errorFrom, linesOf, parentSale, payment, rawItem, variant, variantMapOf } from "./helpers";

/**
 * A mixed cart (customer swaps an item) is where the old all-or-nothing
 * `items.every(qty < 0)` check leaked: one positive line made the whole cart a
 * "sale", and the returned goods were then cost-price and discount checked.
 */
describe("exchange cart: returned lines are exempt, selling lines are not", () => {
    const sold = variant({ name: "New Shirt", price: 200, avgCostPrice: 120 });
    const returned = variant({ name: "Old Shirt", price: 100, avgCostPrice: 150 }); // cost now above price
    const parent = parentSale({ id: 31, items: [{ variant: returned, quantity: 2 }] });

    const base = (over: Record<string, unknown> = {}) =>
        ctx({
            lines: linesOf(rawItem(sold, 1, 200), rawItem(returned, -1, 100)),
            variantMap: variantMapOf(sold, returned),
            parentSale: parent,
            parentSaleId: 31,
            payments: [payment(100)],
            ...over,
        });

    it("does not cost-price check the returned line", () => {
        // returned: refund 100 against a 150 cost — must not raise.
        assert.doesNotThrow(() => prepareExchange(base()));
    });

    it("does not discount check the returned line", () => {
        const context = base({
            lines: linesOf(rawItem(sold, 1, 200), rawItem(returned, -1, 100, 90)),
            payments: [payment(190)],
        });
        assert.doesNotThrow(() => prepareExchange(context));
    });

    it("still cost-price checks the selling line", () => {
        const context = base({
            lines: linesOf(rawItem(sold, 1, 200, 100), rawItem(returned, -1, 100)),
        });
        const err = errorFrom(() => prepareExchange(context));
        assert.match(String(err), /below cost price for New Shirt/);
    });

    it("still rejects a selling line discounted past its price", () => {
        const freebie = variant({ name: "Cap", price: 50, avgCostPrice: 10, saleBelowCost: true });
        const context = base({
            lines: linesOf(rawItem(freebie, 1, 50, 80), rawItem(returned, -1, 100)),
            variantMap: variantMapOf(freebie, returned),
        });
        const err = errorFrom(() => prepareExchange(context));
        assert.match(String(err), /Discount cannot be more than the selling price for Cap/);
    });
});

describe("exchange cart: invoice discount allowance ignores returned lines", () => {
    const sold = variant({ name: "Jacket", price: 300, avgCostPrice: 200 }); // margin 100
    const returned = variant({ name: "Scarf", price: 100, avgCostPrice: 90 });
    const parent = parentSale({ id: 32, items: [{ variant: returned, quantity: 3 }] });

    const lines = linesOf(rawItem(sold, 1, 300), rawItem(returned, -1, 100));
    const vm = variantMapOf(sold, returned);

    it("computes the allowance from the selling line alone", () => {
        // Selling margin only: 300 - 200 = 100.
        // If the returned line were counted it would be 100 + (-100 + 90) = 90.
        assert.equal(maxInvoiceDiscount(lines, vm), 100);
    });

    it("allows an invoice discount up to the selling margin", () => {
        assert.doesNotThrow(() =>
            prepareExchange(
                ctx({ lines, variantMap: vm, parentSale: parent, parentSaleId: 32, discount: 100, payments: [payment(100)] })
            )
        );
    });

    it("rejects an invoice discount above the selling margin", () => {
        const err = errorFrom(() =>
            prepareExchange(
                ctx({ lines, variantMap: vm, parentSale: parent, parentSaleId: 32, discount: 101, payments: [payment(99)] })
            )
        );
        assert.match(String(err), /cannot exceed Rs 100\.00/);
    });
});

describe("exchange cart: the returned half is still validated against the invoice", () => {
    const sold = variant({ name: "Shoes", price: 500, avgCostPrice: 300 });
    const returned = variant({ name: "Sandals", price: 200, avgCostPrice: 100 });
    const parent = parentSale({ id: 33, items: [{ variant: returned, quantity: 1 }] });

    it("refuses to return more than was bought", () => {
        const err = errorFrom(() =>
            prepareExchange(
                ctx({
                    lines: linesOf(rawItem(sold, 1, 500), rawItem(returned, -2, 200)),
                    variantMap: variantMapOf(sold, returned),
                    parentSale: parent,
                    parentSaleId: 33,
                    payments: [payment(100)],
                })
            )
        );
        assert.match(String(err), /Cannot return 2 units of Sandals/);
    });

    it("does not require the newly sold item to be on the original invoice", () => {
        assert.doesNotThrow(() =>
            prepareExchange(
                ctx({
                    lines: linesOf(rawItem(sold, 1, 500), rawItem(returned, -1, 200)),
                    variantMap: variantMapOf(sold, returned),
                    parentSale: parent,
                    parentSaleId: 33,
                    payments: [payment(300)],
                })
            )
        );
    });

    it("does NOT require a parent sale reference — a counter swap has no receipt to hand", () => {
        const plan = prepareExchange(
            ctx({
                lines: linesOf(rawItem(sold, 1, 500), rawItem(returned, -1, 200)),
                variantMap: variantMapOf(sold, returned),
                payments: [payment(300)],
            })
        );
        assert.equal(plan.kind, "EXCHANGE");
        assert.equal(plan.parentSaleId, null);
        assert.equal(plan.totals.totalAmount, 300);
    });

    it("still exempts the unreferenced return line from cost price and discount", () => {
        // Sandals cost 100 and are being handed back at 20 with a 15 discount.
        const dearReturn = variant({ name: "Sandals", price: 200, avgCostPrice: 400 });
        assert.doesNotThrow(() =>
            prepareExchange(
                ctx({
                    lines: linesOf(rawItem(sold, 1, 500), rawItem(dearReturn, -1, 20, 15)),
                    variantMap: variantMapOf(sold, dearReturn),
                    payments: [payment(495)],
                })
            )
        );
    });

    it("validates against the invoice as soon as one is cited voluntarily", () => {
        const err = errorFrom(() =>
            prepareExchange(
                ctx({
                    lines: linesOf(rawItem(sold, 1, 500), rawItem(returned, -2, 200)),
                    variantMap: variantMapOf(sold, returned),
                    parentSale: parent,
                    parentSaleId: 33,
                    payments: [payment(100)],
                })
            )
        );
        assert.match(String(err), /Cannot return 2 units of Sandals/);
    });

    it("computes the net amount the customer still owes", () => {
        const plan = prepareExchange(
            ctx({
                lines: linesOf(rawItem(sold, 1, 500), rawItem(returned, -1, 200)),
                variantMap: variantMapOf(sold, returned),
                parentSale: parent,
                parentSaleId: 33,
                payments: [payment(300)],
            })
        );
        assert.equal(plan.kind, "EXCHANGE");
        assert.equal(plan.totals.totalAmount, 300);
        assert.equal(plan.totals.changeAmount, 0);
        assert.equal(plan.items.map((i) => i.quantity).join(","), "1,-1");
    });
});

describe("line splitting helpers", () => {
    const a = variant();
    const b = variant();
    const lines = linesOf(rawItem(a, 2), rawItem(b, -1));

    it("sellingLinesOnly keeps positive quantities", () => {
        assert.deepEqual(sellingLinesOnly(lines).map((l) => l.qty), [2]);
    });

    it("returnLinesOnly keeps negative quantities", () => {
        assert.deepEqual(returnLinesOnly(lines).map((l) => l.qty), [-1]);
    });
});

describe("prepareSalePlan routes the cart to the right module", () => {
    const v = variant({ price: 100, avgCostPrice: 50 });
    const parent = parentSale({ id: 40, items: [{ variant: v, quantity: 5 }] });

    it("routes an all-positive cart to create sale", () => {
        const plan = prepareSalePlan(
            ctx({ lines: linesOf(rawItem(v, 1)), variantMap: variantMapOf(v), payments: [payment(100)] })
        );
        assert.equal(plan.kind, "SALE");
    });

    it("routes an all-negative cart to return sale", () => {
        const plan = prepareSalePlan(
            ctx({
                lines: linesOf(rawItem(v, -1)),
                variantMap: variantMapOf(v),
                parentSale: parent,
                parentSaleId: 40,
                payments: [payment(-100)],
            })
        );
        assert.equal(plan.kind, "RETURN");
    });

    it("routes a mixed cart to exchange", () => {
        const other = variant({ price: 100, avgCostPrice: 50 });
        const plan = prepareSalePlan(
            ctx({
                lines: linesOf(rawItem(other, 1), rawItem(v, -1)),
                variantMap: variantMapOf(v, other),
                parentSale: parent,
                parentSaleId: 40,
                payments: [payment(0)],
            })
        );
        assert.equal(plan.kind, "EXCHANGE");
    });
});
