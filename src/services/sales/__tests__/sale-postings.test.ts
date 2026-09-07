import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prepareCreateSale } from "../create-sale.service";
import { prepareReturnSale } from "../return-sale.service";
import { prepareExchange } from "../exchange-sale.service";
import { ledgerPosting, stockPostings } from "../sale-postings";
import { ctx, errorFrom, linesOf, parentSale, payment, rawItem, variant, variantMapOf } from "./helpers";

describe("stock postings: direction follows the sign of the quantity", () => {
    it("takes stock out for a sale", () => {
        const v = variant({ price: 100, avgCostPrice: 60 });
        const plan = prepareCreateSale(
            ctx({ lines: linesOf(rawItem(v, 3)), variantMap: variantMapOf(v), payments: [payment(300)] })
        );

        const [posting] = stockPostings(plan);
        assert.equal(posting.type, "SALE");
        assert.equal(posting.productId, v.productId);
        assert.equal(posting.decrementBy, 3); // totalStock -= 3
        assert.equal(posting.quantity, -3); // movement is stock out
        assert.equal(posting.referencePrefix, "INV");
    });

    it("puts stock back for a return", () => {
        const v = variant({ price: 100, avgCostPrice: 60 });
        const parent = parentSale({ id: 50, items: [{ variant: v, quantity: 5 }] });
        const plan = prepareReturnSale(
            ctx({
                lines: linesOf(rawItem(v, -3)),
                variantMap: variantMapOf(v),
                parentSale: parent,
                parentSaleId: 50,
                payments: [payment(-300)],
            })
        );

        const [posting] = stockPostings(plan);
        assert.equal(posting.type, "SALE_RETURN");
        assert.equal(posting.decrementBy, -3); // totalStock -= -3 → +3
        assert.equal(posting.quantity, 3); // movement is stock in
        assert.equal(posting.referencePrefix, "RTN");
    });

    it("scales the movement by the variant pack factor", () => {
        const dozen = variant({ price: 120, avgCostPrice: 8, factor: 12 });
        const plan = prepareCreateSale(
            ctx({ lines: linesOf(rawItem(dozen, 2)), variantMap: variantMapOf(dozen), payments: [payment(240)] })
        );

        const [posting] = stockPostings(plan);
        assert.equal(posting.decrementBy, 24);
        assert.equal(posting.quantity, -24);
    });

    it("posts each half of an exchange in its own direction", () => {
        const sold = variant({ name: "Shoes", price: 500, avgCostPrice: 300 });
        const returned = variant({ name: "Sandals", price: 200, avgCostPrice: 100, factor: 2 });
        const parent = parentSale({ id: 51, items: [{ variant: returned, quantity: 2 }] });

        const plan = prepareExchange(
            ctx({
                lines: linesOf(rawItem(sold, 1, 500), rawItem(returned, -1, 200)),
                variantMap: variantMapOf(sold, returned),
                parentSale: parent,
                parentSaleId: 51,
                payments: [payment(300)],
            })
        );

        const postings = stockPostings(plan);
        assert.deepEqual(
            postings.map((p) => [p.type, p.quantity, p.referencePrefix]),
            [
                ["SALE", -1, "INV"],
                ["SALE_RETURN", 2, "RTN"],
            ]
        );
    });
});

describe("ledger postings", () => {
    const v = variant({ price: 100, avgCostPrice: 60 });

    it("debits the customer for an unpaid sale", () => {
        const plan = prepareCreateSale(
            ctx({ lines: linesOf(rawItem(v, 2)), variantMap: variantMapOf(v), customerId: 5 })
        );

        const ledger = ledgerPosting(plan, 77);
        assert.ok(ledger);
        assert.equal(ledger.type, "SALE");
        assert.equal(ledger.debit, 200);
        assert.equal(ledger.credit, 0);
        assert.match(ledger.message, /Invoice # 77/);
    });

    it("credits the customer for a return settled to their account", () => {
        const parent = parentSale({ id: 52, items: [{ variant: v, quantity: 5 }] });
        const plan = prepareReturnSale(
            ctx({
                lines: linesOf(rawItem(v, -2)),
                variantMap: variantMapOf(v),
                parentSale: parent,
                parentSaleId: 52,
                customerId: 5,
            })
        );

        const ledger = ledgerPosting(plan, 78);
        assert.ok(ledger);
        assert.equal(ledger.type, "SALE_RETURN");
        assert.equal(ledger.credit, 200);
        assert.equal(ledger.debit, 0);
        assert.match(ledger.message, /Customer returned items worth Rs 200/);
    });

    it("posts nothing when the sale is settled in full", () => {
        const plan = prepareCreateSale(
            ctx({
                lines: linesOf(rawItem(v, 2)),
                variantMap: variantMapOf(v),
                customerId: 5,
                payments: [payment(200)],
            })
        );
        assert.equal(ledgerPosting(plan, 79), null);
    });

    it("posts nothing for a walk-in customer", () => {
        const parent = parentSale({ id: 53, items: [{ variant: v, quantity: 5 }] });
        const plan = prepareReturnSale(
            ctx({
                lines: linesOf(rawItem(v, -1)),
                variantMap: variantMapOf(v),
                parentSale: parent,
                parentSaleId: 53,
                payments: [payment(-100)],
            })
        );
        assert.equal(ledgerPosting(plan, 80), null);
    });

    it("ignores the change handed back when working out what is still due", () => {
        const plan = prepareCreateSale(
            ctx({
                lines: linesOf(rawItem(v, 2)), // 200
                variantMap: variantMapOf(v),
                customerId: 5,
                payments: [payment(500)],
            })
        );
        assert.equal(plan.totals.changeAmount, 300);
        assert.equal(ledgerPosting(plan, 81), null);
    });
});

describe("service products never move stock", () => {
    const service = variant({ name: "Installation Fee", price: 500, avgCostPrice: 100, isService: true });
    const goods = variant({ name: "Water Heater", price: 8000, avgCostPrice: 6000 });

    it("posts nothing when a service is sold", () => {
        const plan = prepareCreateSale(
            ctx({ lines: linesOf(rawItem(service, 2)), variantMap: variantMapOf(service), payments: [payment(1000)] })
        );
        assert.deepEqual(stockPostings(plan), []);
    });

    it("posts nothing when a service is returned", () => {
        const parent = parentSale({ id: 60, items: [{ variant: service, quantity: 2 }] });
        const plan = prepareReturnSale(
            ctx({
                lines: linesOf(rawItem(service, -1)),
                variantMap: variantMapOf(service),
                parentSale: parent,
                parentSaleId: 60,
                payments: [payment(-500)],
            })
        );
        assert.deepEqual(stockPostings(plan), []);
    });

    it("still moves stock for the goods sold alongside a service", () => {
        const plan = prepareCreateSale(
            ctx({
                lines: linesOf(rawItem(goods, 1), rawItem(service, 1)),
                variantMap: variantMapOf(goods, service),
                payments: [payment(8500)],
            })
        );

        const postings = stockPostings(plan);
        assert.equal(postings.length, 1);
        assert.equal(postings[0].productId, goods.productId);
        assert.equal(postings[0].decrementBy, 1);
    });

    it("skips only the service half of an exchange", () => {
        const parent = parentSale({ id: 61, items: [{ variant: service, quantity: 1 }] });
        const plan = prepareExchange(
            ctx({
                lines: linesOf(rawItem(goods, 1), rawItem(service, -1)),
                variantMap: variantMapOf(goods, service),
                parentSale: parent,
                parentSaleId: 61,
                payments: [payment(7500)],
            })
        );

        const postings = stockPostings(plan);
        assert.equal(postings.length, 1);
        assert.equal(postings[0].type, "SALE");
        assert.equal(postings[0].productId, goods.productId);
    });

    it("ignores the pack factor for a service", () => {
        const packaged = variant({ name: "Support Pack", price: 1000, factor: 12, isService: true });
        const plan = prepareCreateSale(
            ctx({ lines: linesOf(rawItem(packaged, 3)), variantMap: variantMapOf(packaged), payments: [payment(3000)] })
        );
        assert.deepEqual(stockPostings(plan), []);
    });

    it("still records the sale line, its money and its cost snapshot", () => {
        const plan = prepareCreateSale(
            ctx({ lines: linesOf(rawItem(service, 2)), variantMap: variantMapOf(service), payments: [payment(1000)] })
        );
        assert.equal(plan.items.length, 1);
        assert.equal(plan.items[0].quantity, 2);
        assert.equal(plan.items[0].totalPrice, 1000);
        assert.equal(plan.items[0].avgCostPrice, 100);
        assert.equal(plan.totals.totalAmount, 1000);
    });

    it("still applies the cost price rule to a service", () => {
        const err = errorFrom(() =>
            prepareCreateSale(
                ctx({
                    lines: linesOf(rawItem(service, 1, 500, 450)), // net 50 < cost 100
                    variantMap: variantMapOf(service),
                    payments: [payment(50)],
                })
            )
        );
        assert.match(String(err), /below cost price for Installation Fee/);
    });
});
