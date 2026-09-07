import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prepareCreateSale } from "../create-sale.service";
import {
    assertInvoiceDiscountWithinMargin,
    assertLineDiscountWithinCost,
    maxInvoiceDiscount,
    variantUnitCost,
} from "../create-sale.rules";
import { ctx, errorFrom, linesOf, payment, rawItem, variant, variantMapOf } from "./helpers";

describe("create sale: cost price policy", () => {
    it("blocks a selling line discounted below the variant cost", () => {
        const v = variant({ name: "Rice 5kg", price: 100, avgCostPrice: 80 });
        const err = errorFrom(() =>
            prepareCreateSale(
                ctx({
                    lines: linesOf(rawItem(v, 1, 100, 30)), // net 70 < cost 80
                    variantMap: variantMapOf(v),
                    payments: [payment(70)],
                })
            )
        );
        assert.match(String(err), /below cost price for Rice 5kg/);
    });

    it("allows a selling line at or above cost", () => {
        const v = variant({ price: 100, avgCostPrice: 80 });
        assert.doesNotThrow(() =>
            prepareCreateSale(
                ctx({ lines: linesOf(rawItem(v, 1, 100, 20)), variantMap: variantMapOf(v), payments: [payment(80)] })
            )
        );
    });

    it("allows selling below cost when the product opts in", () => {
        const v = variant({ price: 100, avgCostPrice: 80, saleBelowCost: true });
        assert.doesNotThrow(() =>
            prepareCreateSale(
                ctx({ lines: linesOf(rawItem(v, 1, 100, 50)), variantMap: variantMapOf(v), payments: [payment(50)] })
            )
        );
    });

    it("rejects a discount larger than the selling price", () => {
        const v = variant({ name: "Soap", price: 100, avgCostPrice: 10, saleBelowCost: true });
        const err = errorFrom(() =>
            assertLineDiscountWithinCost(linesOf(rawItem(v, 1, 100, 120)), variantMapOf(v))
        );
        assert.match(String(err), /Discount cannot be more than the selling price for Soap/);
    });
});

describe("create sale: variants stay intact", () => {
    it("scales the cost limit by the variant pack factor", () => {
        const dozen = variant({ name: "Pen", price: 120, avgCostPrice: 8, factor: 12 }); // unit cost 96
        assert.equal(variantUnitCost(dozen), 96);

        const tooCheap = errorFrom(() =>
            assertLineDiscountWithinCost(linesOf(rawItem(dozen, 1, 120, 30)), variantMapOf(dozen))
        );
        assert.match(String(tooCheap), /below cost price for Pen/);

        assert.doesNotThrow(() =>
            assertLineDiscountWithinCost(linesOf(rawItem(dozen, 1, 120, 20)), variantMapOf(dozen))
        );
    });

    it("judges each variant of the same cart against its own cost", () => {
        const unit = variant({ name: "Pen unit", price: 12, avgCostPrice: 8, factor: 1 });
        const dozen = variant({ name: "Pen dozen", price: 120, avgCostPrice: 8, factor: 12 });
        assert.doesNotThrow(() =>
            assertLineDiscountWithinCost(
                linesOf(rawItem(unit, 5, 12, 3), rawItem(dozen, 1, 120, 20)),
                variantMapOf(unit, dozen)
            )
        );
    });

    it("snapshots the cost per variant onto each item", () => {
        const unit = variant({ price: 12, avgCostPrice: 8, factor: 1 });
        const dozen = variant({ price: 120, avgCostPrice: 8, factor: 12 });
        const plan = prepareCreateSale(
            ctx({
                lines: linesOf(rawItem(unit, 2), rawItem(dozen, 1)),
                variantMap: variantMapOf(unit, dozen),
                payments: [payment(144)],
            })
        );
        assert.equal(plan.items[0].avgCostPrice, 8);
        assert.equal(plan.items[1].avgCostPrice, 96);
    });

    it("falls back to 95% of the variant price when the average cost is unusable", () => {
        const v = variant({ price: 200, avgCostPrice: 0, saleBelowCost: true });
        const plan = prepareCreateSale(
            ctx({ lines: linesOf(rawItem(v, 1)), variantMap: variantMapOf(v), payments: [payment(200)] })
        );
        assert.equal(plan.items[0].avgCostPrice, 190);
    });
});

describe("create sale: invoice discount policy", () => {
    it("caps the invoice discount at the margin above cost", () => {
        const v = variant({ price: 100, avgCostPrice: 60 });
        const lines = linesOf(rawItem(v, 2)); // margin = (100-60) * 2 = 80
        assert.equal(maxInvoiceDiscount(lines, variantMapOf(v)), 80);

        assert.throws(
            () => assertInvoiceDiscountWithinMargin(lines, variantMapOf(v), 81),
            /cannot exceed Rs 80\.00/
        );
        assert.doesNotThrow(() => assertInvoiceDiscountWithinMargin(lines, variantMapOf(v), 80));
    });

    it("has no limit when every item may be sold below cost", () => {
        const v = variant({ price: 100, avgCostPrice: 60, saleBelowCost: true });
        const lines = linesOf(rawItem(v, 2));
        assert.equal(maxInvoiceDiscount(lines, variantMapOf(v)), null);
        assert.doesNotThrow(() => assertInvoiceDiscountWithinMargin(lines, variantMapOf(v), 5000));
    });
});

describe("create sale: payment requirement and totals", () => {
    it("requires payments or a customer", () => {
        const v = variant({ price: 100, avgCostPrice: 10 });
        const err = errorFrom(() =>
            prepareCreateSale(ctx({ lines: linesOf(rawItem(v, 1)), variantMap: variantMapOf(v) }))
        );
        assert.match(String(err), /payments or customerId is required/);

        assert.doesNotThrow(() =>
            prepareCreateSale(ctx({ lines: linesOf(rawItem(v, 1)), variantMap: variantMapOf(v), customerId: 4 }))
        );
    });

    it("computes total, change and net paid", () => {
        const v = variant({ price: 100, avgCostPrice: 10 });
        const plan = prepareCreateSale(
            ctx({
                lines: linesOf(rawItem(v, 2, 100, 5)), // 190
                variantMap: variantMapOf(v),
                discount: 10,
                taxAmount: 5,
                payments: [payment(200)],
            })
        );
        assert.equal(plan.kind, "SALE");
        assert.equal(plan.totals.totalAmount, 185);
        assert.equal(plan.totals.paidAmount, 200);
        assert.equal(plan.totals.changeAmount, 15);
        assert.equal(plan.totals.netPaidAmount, 185);
    });

    it("takes the change out of the largest payment leg first", () => {
        const v = variant({ price: 100, avgCostPrice: 10 });
        const plan = prepareCreateSale(
            ctx({
                lines: linesOf(rawItem(v, 1)), // 100
                variantMap: variantMapOf(v),
                payments: [payment(40, 1), payment(90, 2)],
            })
        );
        assert.equal(plan.totals.changeAmount, 30);
        assert.deepEqual(
            plan.totals.payments.map((p) => [p.accountId, p.amount, p.changeAmount]),
            [
                [1, 40, 0],
                [2, 60, 30],
            ]
        );
    });

    it("refuses a cart containing a return line", () => {
        const v = variant();
        const err = errorFrom(() =>
            prepareCreateSale(ctx({ lines: linesOf(rawItem(v, -1)), variantMap: variantMapOf(v), payments: [payment(0)] }))
        );
        assert.match(String(err), /prepareReturnSale/);
    });
});
