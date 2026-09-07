import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPrepareContext, normalizePayments, parseLines, toNumberOrNull, toNumberOrZero } from "../sale-request";
import { UNRESTRICTED } from "../cashier-policy";
import { prepareSalePlan } from "../sales.service";
import { errorFrom, parentSale, variant, variantMapOf } from "./helpers";
import type { SaleRequestInput } from "../types";

describe("sale-request: coercion of an HTTP body", () => {
    it("reads numeric ids that arrive as strings", () => {
        assert.equal(toNumberOrNull("12"), 12);
        assert.equal(toNumberOrNull(12), 12);
    });

    it("treats blank, missing and unparseable ids as absent", () => {
        assert.equal(toNumberOrNull(""), null);
        assert.equal(toNumberOrNull(null), null);
        assert.equal(toNumberOrNull(undefined), null);
        assert.equal(toNumberOrNull("abc"), null);
    });

    it("falls back to zero for money fields", () => {
        assert.equal(toNumberOrZero(undefined), 0);
        assert.equal(toNumberOrZero(null), 0);
        assert.equal(toNumberOrZero("abc"), 0);
        assert.equal(toNumberOrZero("15.5"), 15.5);
    });

    it("drops holes in a sparse payments array", () => {
        assert.deepEqual(normalizePayments(undefined), []);
        assert.deepEqual(normalizePayments(null), []);
        assert.deepEqual(normalizePayments([null as any, { accountId: 1, amount: 5 }]), [
            { accountId: 1, amount: 5 },
        ]);
    });
});

describe("sale-request: building the prepare context", () => {
    const v = variant({ price: 100, avgCostPrice: 60 });

    const input: SaleRequestInput = {
        customerId: "4",
        parentSaleId: "9",
        note: 7 as unknown as string,
        discount: "10",
        taxAmount: "2.5",
        items: [{ variantId: String(v.id), qty: "-2", unitPrice: "100", discount: "5" }],
        payments: [{ accountId: 1, amount: "-190" }],
    };

    it("coerces every field the POS may send as a string", () => {
        const lines = parseLines(input);
        const ctx = buildPrepareContext({
            input,
            lines,
            variantMap: variantMapOf(v),
            parentSale: null,
            userId: 3,
            policy: UNRESTRICTED,
        });

        assert.equal(ctx.customerId, 4);
        assert.equal(ctx.parentSaleId, 9);
        assert.equal(ctx.note, "7");
        assert.equal(ctx.discount, 10);
        assert.equal(ctx.taxAmount, 2.5);
        assert.equal(ctx.userId, 3);
        assert.deepEqual(ctx.lines, [{ variantId: v.id, qty: -2, unitPrice: 100, discount: 5, isReturn: true }]);
    });

    it("keeps a string negative quantity classified as a return end to end", () => {
        const lines = parseLines(input);
        const plan = prepareSalePlan(
            buildPrepareContext({
                input,
                lines,
                variantMap: variantMapOf(v),
                parentSale: parentSale({ id: 9, items: [{ variant: v, quantity: 5 }] }),
                userId: 3,
                policy: UNRESTRICTED,
            })
        );

        assert.equal(plan.kind, "RETURN");
        assert.equal(plan.customerId, 4);
        assert.equal(plan.parentSaleId, 9);
        // -2 x (100 - 5) = -190, minus the 10 invoice discount, plus 2.5 tax.
        assert.equal(plan.totals.totalAmount, -197.5);
        assert.equal(plan.totals.changeAmount, 0);
    });

    it("rejects a malformed cart before anything is loaded", () => {
        assert.match(String(errorFrom(() => parseLines({ items: [] }))), /items are required/);
        assert.match(
            String(errorFrom(() => parseLines({ items: [{ variantId: 1, qty: "x", unitPrice: 5 }] }))),
            /Invalid quantity/
        );
    });

    it("accepts a credit sale posted with no payments key at all", () => {
        const saleInput: SaleRequestInput = {
            customerId: 4,
            items: [{ variantId: v.id, qty: 1, unitPrice: 100 }],
        };
        const plan = prepareSalePlan(
            buildPrepareContext({
                input: saleInput,
                lines: parseLines(saleInput),
                variantMap: variantMapOf(v),
                parentSale: null,
                userId: null,
                policy: UNRESTRICTED,
            })
        );

        assert.equal(plan.kind, "SALE");
        assert.equal(plan.totals.paidAmount, 0);
        assert.equal(plan.totals.totalAmount, 100);
        assert.deepEqual(plan.totals.payments, []);
    });
});
