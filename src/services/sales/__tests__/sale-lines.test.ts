import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cartKind, classifyCart, isReturnQty, normalizeLines, uniqueVariantIds } from "../sale-lines";
import { linesOf, rawItem, variant } from "./helpers";

describe("sale-lines: negative quantity marks a return", () => {
    it("treats qty < 0 as a return and qty > 0 as a sale", () => {
        assert.equal(isReturnQty(-1), true);
        assert.equal(isReturnQty(-0.5), true);
        assert.equal(isReturnQty(1), false);
        assert.equal(isReturnQty(0), false);
        assert.equal(isReturnQty("-3"), true);
    });

    it("flags isReturn on each normalized line", () => {
        const a = variant();
        const b = variant();
        const lines = linesOf(rawItem(a, 2), rawItem(b, -3));

        assert.equal(lines[0].isReturn, false);
        assert.equal(lines[1].isReturn, true);
        assert.equal(lines[1].qty, -3);
    });
});

describe("sale-lines: input validation", () => {
    it("rejects an empty cart", () => {
        assert.throws(() => normalizeLines([]), /items are required/);
        assert.throws(() => normalizeLines(undefined), /items are required/);
    });

    it("rejects a zero quantity but accepts a negative one", () => {
        const v = variant();
        assert.throws(() => normalizeLines([rawItem(v, 0)]), /Invalid quantity/);
        assert.doesNotThrow(() => normalizeLines([rawItem(v, -1)]));
    });

    it("rejects missing fields and negative unit prices", () => {
        assert.throws(() => normalizeLines([{ variantId: 1, qty: 1 } as any]), /variantId, quantity, and unitPrice/);
        assert.throws(() => normalizeLines([{ variantId: 1, qty: 1, unitPrice: -5 }]), /Invalid unitPrice/);
    });

    it("defaults a missing item discount to zero", () => {
        const v = variant();
        const [line] = normalizeLines([{ variantId: v.id, qty: 1, unitPrice: 100 }]);
        assert.equal(line.discount, 0);
    });
});

describe("sale-lines: cart classification", () => {
    const a = variant();
    const b = variant();

    it("classifies an all-positive cart as a sale", () => {
        const cart = classifyCart(linesOf(rawItem(a, 1), rawItem(b, 2)));
        assert.equal(cart.isPureSale, true);
        assert.equal(cart.isPureReturn, false);
        assert.equal(cart.isMixed, false);
        assert.equal(cartKind(cart), "SALE");
        assert.equal(cart.returnLines.length, 0);
    });

    it("classifies an all-negative cart as a return", () => {
        const cart = classifyCart(linesOf(rawItem(a, -1), rawItem(b, -2)));
        assert.equal(cart.isPureReturn, true);
        assert.equal(cart.hasSaleLines, false);
        assert.equal(cartKind(cart), "RETURN");
        assert.equal(cart.returnLines.length, 2);
    });

    it("classifies a cart holding both as an exchange", () => {
        const cart = classifyCart(linesOf(rawItem(a, 1), rawItem(b, -2)));
        assert.equal(cart.isMixed, true);
        assert.equal(cartKind(cart), "EXCHANGE");
        assert.equal(cart.saleLines.length, 1);
        assert.equal(cart.returnLines.length, 1);
    });

    it("collects distinct variant ids across mixed lines", () => {
        const lines = linesOf(rawItem(a, 1), rawItem(a, -1), rawItem(b, 3));
        assert.deepEqual(uniqueVariantIds(lines).sort(), [a.id, b.id].sort());
    });
});
