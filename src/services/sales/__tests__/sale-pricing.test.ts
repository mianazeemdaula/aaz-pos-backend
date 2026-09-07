import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildItems, computeTotals, distributeChange, lineTotal, linesSubtotal, snapshotUnitCost, sumPayments } from "../sale-pricing";
import { linesOf, payment, rawItem, variant, variantMapOf } from "./helpers";

describe("sale-pricing: line maths", () => {
    it("nets the discount off the unit price before multiplying", () => {
        const v = variant({ price: 100 });
        const [line] = linesOf(rawItem(v, 3, 100, 10));
        assert.equal(lineTotal(line), 270);
    });

    it("keeps a return line negative", () => {
        const v = variant({ price: 100 });
        const [line] = linesOf(rawItem(v, -3, 100, 10));
        assert.equal(lineTotal(line), -270);
    });

    it("rounds the unit price to two decimals before multiplying out", () => {
        const v = variant({ price: 33.333 });
        // 33.333 -> 33.33, x3 = 99.99;  0.005 -> 0.01, x1 = 0.01
        assert.equal(lineTotal(linesOf(rawItem(v, 3, 33.333))[0]), 99.99);
        assert.equal(linesSubtotal(linesOf(rawItem(v, 3, 33.333), rawItem(v, 1, 0.005))), 100);
    });

    it("nets a sale line against a return line in the same cart", () => {
        const a = variant({ price: 500 });
        const b = variant({ price: 200 });
        assert.equal(linesSubtotal(linesOf(rawItem(a, 1, 500), rawItem(b, -1, 200))), 300);
    });
});

describe("sale-pricing: payments", () => {
    it("treats a missing payments array as zero paid", () => {
        assert.equal(sumPayments(undefined), 0);
        assert.equal(sumPayments(null), 0);
        assert.equal(sumPayments([]), 0);
    });

    it("sums split payment legs", () => {
        assert.equal(sumPayments([payment(120.5, 1), payment(79.5, 2)]), 200);
    });

    it("hands back no change when nothing is overpaid", () => {
        assert.deepEqual(
            distributeChange([payment(100, 1)], 0).map((p) => [p.amount, p.changeAmount]),
            [[100, 0]]
        );
    });

    it("spills over to the next leg when the largest cannot absorb all the change", () => {
        const result = distributeChange([payment(30, 1), payment(50, 2)], 60);
        assert.deepEqual(
            result.map((p) => [p.accountId, p.amount, p.changeAmount]),
            [
                [1, 20, 10],
                [2, 0, 50],
            ]
        );
    });

    it("carries the payment note through", () => {
        const [leg] = distributeChange([{ accountId: 3, amount: 10, note: "cash drawer" }], 0);
        assert.equal(leg.note, "cash drawer");
    });
});

describe("sale-pricing: totals", () => {
    const v = variant({ price: 100 });

    it("subtracts the invoice discount and adds tax", () => {
        const totals = computeTotals({
            lines: linesOf(rawItem(v, 2, 100)),
            discount: 25,
            taxAmount: 5,
            payments: [payment(180)],
            allowChange: true,
        });
        assert.equal(totals.totalAmount, 180);
        assert.equal(totals.changeAmount, 0);
        assert.equal(totals.netPaidAmount, 180);
    });

    it("never produces change when change is not allowed", () => {
        const totals = computeTotals({
            lines: linesOf(rawItem(v, -2, 100)),
            discount: 0,
            taxAmount: 0,
            payments: [payment(-200)],
            allowChange: false,
        });
        assert.equal(totals.totalAmount, -200);
        assert.equal(totals.changeAmount, 0);
        assert.equal(totals.netPaidAmount, -200);
    });

    it("survives a credit sale posted with no payments at all", () => {
        const totals = computeTotals({
            lines: linesOf(rawItem(v, 1, 100)),
            discount: 0,
            taxAmount: 0,
            payments: undefined,
            allowChange: true,
        });
        assert.equal(totals.totalAmount, 100);
        assert.equal(totals.paidAmount, 0);
        assert.equal(totals.netPaidAmount, 0);
        assert.deepEqual(totals.payments, []);
    });
});

describe("sale-pricing: cost snapshot per variant", () => {
    it("multiplies the product average cost by the pack factor", () => {
        assert.equal(snapshotUnitCost({ price: 120, factor: 12, product: { avgCostPrice: 8 } }), 96);
    });

    it("falls back to 95% of the variant price when the average cost is zero", () => {
        assert.equal(snapshotUnitCost({ price: 200, factor: 1, product: { avgCostPrice: 0 } }), 190);
    });

    it("falls back when the average cost is corrupt", () => {
        assert.equal(snapshotUnitCost({ price: 200, factor: 1, product: { avgCostPrice: 1e12 } }), 190);
        assert.equal(snapshotUnitCost({ price: 200, factor: 1, product: { avgCostPrice: NaN } }), 190);
    });

    it("snapshots the cost on returned items too", () => {
        const v = variant({ price: 100, avgCostPrice: 60 });
        const [item] = buildItems(linesOf(rawItem(v, -2, 100)), variantMapOf(v));
        assert.equal(item.avgCostPrice, 60);
        assert.equal(item.quantity, -2);
        assert.equal(item.totalPrice, -200);
    });
});
