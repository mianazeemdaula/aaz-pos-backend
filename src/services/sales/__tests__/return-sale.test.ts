import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prepareReturnSale } from "../return-sale.service";
import {
    alreadyReturnedQty,
    assertReturnableAgainstParent,
    remainingReturnableQty,
} from "../return-sale.rules";
import { maxInvoiceDiscount } from "../create-sale.rules";
import { ctx, errorFrom, linesOf, parentSale, payment, rawItem, variant, variantMapOf } from "./helpers";

/**
 * The two rules this suite exists to lock down:
 *   1. a negative-qty line is never cost-price checked
 *   2. a negative-qty line is never discount checked
 */
describe("return sale: cost price is NOT checked", () => {
    it("accepts a return of an item whose refund price is below its cost", () => {
        // Cost moved up to 150 since the customer bought it at 100.
        const v = variant({ name: "Cooking Oil", price: 100, avgCostPrice: 150, saleBelowCost: false });
        const parent = parentSale({ id: 9, items: [{ variant: v, quantity: 5 }] });

        const plan = prepareReturnSale(
            ctx({
                lines: linesOf(rawItem(v, -2, 100)),
                variantMap: variantMapOf(v),
                parentSale: parent,
                parentSaleId: 9,
                payments: [payment(-200)],
            })
        );

        assert.equal(plan.kind, "RETURN");
        assert.equal(plan.totals.totalAmount, -200);
    });

    it("accepts a return even when the pack factor pushes the cost far above the refund", () => {
        const dozen = variant({ name: "Pen dozen", price: 120, avgCostPrice: 40, factor: 12 }); // unit cost 480
        const parent = parentSale({ id: 3, items: [{ variant: dozen, quantity: 2 }] });

        assert.doesNotThrow(() =>
            prepareReturnSale(
                ctx({
                    lines: linesOf(rawItem(dozen, -1, 120)),
                    variantMap: variantMapOf(dozen),
                    parentSale: parent,
                    parentSaleId: 3,
                    payments: [payment(-120)],
                })
            )
        );
    });

    it("accepts a refund at a price the same item could not be sold at", () => {
        const v = variant({ name: "Tea", price: 100, avgCostPrice: 90, saleBelowCost: false });
        const parent = parentSale({ id: 4, items: [{ variant: v, quantity: 3 }] });

        // Item was originally sold at 50 (clearance). Refunding 50 is below the 90 cost.
        assert.doesNotThrow(() =>
            prepareReturnSale(
                ctx({
                    lines: linesOf(rawItem(v, -1, 50)),
                    variantMap: variantMapOf(v),
                    parentSale: parent,
                    parentSaleId: 4,
                    payments: [payment(-50)],
                })
            )
        );
    });
});

describe("return sale: discount is NOT checked", () => {
    it("accepts a return line carrying the discount the customer originally got", () => {
        const v = variant({ name: "Shampoo", price: 100, avgCostPrice: 95, saleBelowCost: false });
        const parent = parentSale({ id: 11, items: [{ variant: v, quantity: 4 }] });

        // A 40 per-unit discount would be rejected outright on a selling line.
        const plan = prepareReturnSale(
            ctx({
                lines: linesOf(rawItem(v, -2, 100, 40)),
                variantMap: variantMapOf(v),
                parentSale: parent,
                parentSaleId: 11,
                payments: [payment(-120)],
            })
        );
        assert.equal(plan.totals.totalAmount, -120);
        assert.equal(plan.items[0].discount, 40);
    });

    it("accepts a return line whose discount exceeds the unit price", () => {
        const v = variant({ name: "Biscuit", price: 50, avgCostPrice: 30 });
        const parent = parentSale({ id: 12, items: [{ variant: v, quantity: 2 }] });

        assert.doesNotThrow(() =>
            prepareReturnSale(
                ctx({
                    lines: linesOf(rawItem(v, -1, 50, 60)),
                    variantMap: variantMapOf(v),
                    parentSale: parent,
                    parentSaleId: 12,
                    payments: [payment(10)],
                })
            )
        );
    });

    it("applies no invoice discount ceiling to a pure return cart", () => {
        const v = variant({ price: 100, avgCostPrice: 90 });
        const lines = linesOf(rawItem(v, -3, 100));

        // No selling line contributes, so there is no margin allowance at all.
        assert.equal(maxInvoiceDiscount(lines, variantMapOf(v)), null);

        const parent = parentSale({ id: 13, items: [{ variant: v, quantity: 5 }] });
        assert.doesNotThrow(() =>
            prepareReturnSale(
                ctx({
                    lines,
                    variantMap: variantMapOf(v),
                    parentSale: parent,
                    parentSaleId: 13,
                    discount: 250,
                    payments: [payment(-50)],
                })
            )
        );
    });
});

describe("return sale: original invoice rules", () => {
    const v = variant({ name: "Sugar 1kg", price: 100, avgCostPrice: 60 });
    const other = variant({ name: "Salt", price: 40, avgCostPrice: 20 });

    it("requires a parent sale reference", () => {
        const err = errorFrom(() =>
            prepareReturnSale(
                ctx({ lines: linesOf(rawItem(v, -1)), variantMap: variantMapOf(v), payments: [payment(-100)] })
            )
        );
        assert.match(String(err), /parentSaleId\) is required for returns/);
    });

    it("requires a refund destination for a walk-in customer", () => {
        const parent = parentSale({ id: 5, items: [{ variant: v, quantity: 2 }] });
        const err = errorFrom(() =>
            prepareReturnSale(
                ctx({ lines: linesOf(rawItem(v, -1)), variantMap: variantMapOf(v), parentSale: parent, parentSaleId: 5 })
            )
        );
        assert.match(String(err), /Refund payment account is required/);
    });

    it("accepts a walk-in-less return when the refund goes to a customer ledger", () => {
        const parent = parentSale({ id: 5, items: [{ variant: v, quantity: 2 }] });
        assert.doesNotThrow(() =>
            prepareReturnSale(
                ctx({
                    lines: linesOf(rawItem(v, -1)),
                    variantMap: variantMapOf(v),
                    parentSale: parent,
                    parentSaleId: 5,
                    customerId: 3,
                })
            )
        );
    });

    it("refuses a return of an item that was not on the original invoice", () => {
        const parent = parentSale({ id: 6, items: [{ variant: v, quantity: 2 }] });
        const err = errorFrom(() => assertReturnableAgainstParent(linesOf(rawItem(other, -1)), parent));
        assert.match(String(err), /was not purchased in the original sale #6/);
        assert.ok(String(err).includes("Variant ID " + other.id));
    });

    it("refuses more units than were sold", () => {
        const parent = parentSale({ id: 7, items: [{ variant: v, quantity: 2 }] });
        const err = errorFrom(() => assertReturnableAgainstParent(linesOf(rawItem(v, -3)), parent));
        assert.match(String(err), /Cannot return 3 units of Sugar 1kg\. Max returnable quantity is 2/);
    });

    it("counts earlier returns against the remaining quantity", () => {
        const parent = parentSale({
            id: 8,
            items: [{ variant: v, quantity: 5 }],
            returns: [[{ variant: v, quantity: -2 }], [{ variant: v, quantity: -1 }]],
        });

        assert.equal(alreadyReturnedQty(parent, v.id), 3);
        assert.equal(remainingReturnableQty(parent, v.id), 2);

        assert.doesNotThrow(() => assertReturnableAgainstParent(linesOf(rawItem(v, -2)), parent));
        const err = errorFrom(() => assertReturnableAgainstParent(linesOf(rawItem(v, -3)), parent));
        assert.match(String(err), /Already returned: 3/);
    });

    it("refuses a return booked against another return", () => {
        const parent = parentSale({ id: 10, totalAmount: -300, items: [{ variant: v, quantity: 3 }] });
        const err = errorFrom(() =>
            prepareReturnSale(
                ctx({
                    lines: linesOf(rawItem(v, -1)),
                    variantMap: variantMapOf(v),
                    parentSale: parent,
                    parentSaleId: 10,
                    payments: [payment(-100)],
                })
            )
        );
        assert.match(String(err), /Cannot create a return against a return transaction/);
    });
});

describe("return sale: money and stock direction", () => {
    const v = variant({ name: "Rice", price: 100, avgCostPrice: 60 });
    const parent = parentSale({ id: 20, items: [{ variant: v, quantity: 10 }] });

    const plan = () =>
        prepareReturnSale(
            ctx({
                lines: linesOf(rawItem(v, -3, 100)),
                variantMap: variantMapOf(v),
                parentSale: parent,
                parentSaleId: 20,
                payments: [payment(-300)],
            })
        );

    it("produces a negative total and negative line totals", () => {
        const p = plan();
        assert.equal(p.totals.totalAmount, -300);
        assert.equal(p.items[0].totalPrice, -300);
        assert.equal(p.items[0].quantity, -3);
    });

    it("never hands back change on a refund", () => {
        const p = plan();
        assert.equal(p.totals.changeAmount, 0);
        assert.equal(p.totals.netPaidAmount, -300);
        assert.equal(p.totals.payments[0].changeAmount, 0);
        assert.equal(p.totals.payments[0].amount, -300);
    });

    it("keeps every line flagged as a return so stock moves back in", () => {
        assert.ok(plan().lines.every((l) => l.isReturn));
    });

    it("still snapshots the variant cost on the returned item", () => {
        assert.equal(plan().items[0].avgCostPrice, 60);
    });

    it("refuses a cart containing a selling line", () => {
        const err = errorFrom(() =>
            prepareReturnSale(
                ctx({ lines: linesOf(rawItem(v, 1)), variantMap: variantMapOf(v), parentSaleId: 20, parentSale: parent })
            )
        );
        assert.match(String(err), /prepareExchange/);
    });
});
