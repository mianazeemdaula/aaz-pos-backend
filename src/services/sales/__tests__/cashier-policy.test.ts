import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ALLOW_PRICE_CHANGE_KEY,
    MAX_DISCOUNT_KEY,
    UNRESTRICTED,
    allowedPrices,
    assertCashierPolicy,
    assertInvoiceDiscountLimit,
    assertLineDiscountLimit,
    assertPriceChangePolicy,
    discountPercentOf,
    resolveCashierPolicy,
    sellingGross,
} from "../cashier-policy";
import { prepareCreateSale } from "../create-sale.service";
import { prepareReturnSale } from "../return-sale.service";
import { prepareExchange } from "../exchange-sale.service";
import { cashierPolicy, ctx, errorFrom, linesOf, parentSale, payment, rawItem, variant, variantMapOf } from "./helpers";

describe("resolving the till policy from settings", () => {
    it("permits everything when nothing is configured", () => {
        const policy = resolveCashierPolicy({ role: "CASHIER", appSettings: {} });
        assert.equal(policy.allowPriceChange, true);
        assert.equal(policy.maxDiscountPercent, null);
        assert.equal(policy.exempt, false);
    });

    it("reads the two settings the admin screen writes", () => {
        const policy = resolveCashierPolicy({
            role: "CASHIER",
            appSettings: { [ALLOW_PRICE_CHANGE_KEY]: false, [MAX_DISCOUNT_KEY]: 10 },
        });
        assert.equal(policy.allowPriceChange, false);
        assert.equal(policy.maxDiscountPercent, 10);
    });

    it("accepts the string forms the settings table stores", () => {
        const policy = resolveCashierPolicy({
            role: "CASHIER",
            appSettings: { [ALLOW_PRICE_CHANGE_KEY]: "false", [MAX_DISCOUNT_KEY]: "7.5" },
        });
        assert.equal(policy.allowPriceChange, false);
        assert.equal(policy.maxDiscountPercent, 7.5);
    });

    it("lets a per-user value override the global one", () => {
        const policy = resolveCashierPolicy({
            role: "CASHIER",
            appSettings: { [MAX_DISCOUNT_KEY]: 5, [ALLOW_PRICE_CHANGE_KEY]: false },
            userSettings: { [MAX_DISCOUNT_KEY]: 25, [ALLOW_PRICE_CHANGE_KEY]: true },
        });
        assert.equal(policy.maxDiscountPercent, 25);
        assert.equal(policy.allowPriceChange, true);
    });

    it("treats 100% or more, and nonsense, as no limit at all", () => {
        for (const value of [100, 150, "", null, undefined, "abc", -5]) {
            const policy = resolveCashierPolicy({ role: "CASHIER", appSettings: { [MAX_DISCOUNT_KEY]: value } });
            assert.equal(policy.maxDiscountPercent, null, `value ${String(value)}`);
        }
    });

    it("exempts an administrator and binds everyone else", () => {
        const app = { [MAX_DISCOUNT_KEY]: 5, [ALLOW_PRICE_CHANGE_KEY]: false };
        assert.equal(resolveCashierPolicy({ role: "ADMIN", appSettings: app }).exempt, true);
        for (const role of ["MANAGER", "CASHIER", "DELIVERY_BOY", "WORKER", "", null]) {
            assert.equal(resolveCashierPolicy({ role, appSettings: app }).exempt, false, String(role));
        }
    });
});

describe("Allow Cashiers to Edit Unit Prices", () => {
    const item = variant({ name: "Rice 5kg", price: 100, retail: 110, wholesale: 90, avgCostPrice: 50 });
    const locked = cashierPolicy({ allowPriceChange: false });

    it("lists the variant's own price lists as the permitted prices", () => {
        assert.deepEqual(allowedPrices(item), [100, 110, 90]);
        assert.deepEqual(allowedPrices(variant({ price: 60 })), [60]);
    });

    it("accepts any of the variant's price lists", () => {
        for (const price of [100, 110, 90]) {
            assert.doesNotThrow(
                () => assertPriceChangePolicy(linesOf(rawItem(item, 1, price)), variantMapOf(item), locked),
                `price ${price} should be allowed`
            );
        }
    });

    it("rejects a price the cashier typed themselves", () => {
        const err = errorFrom(() =>
            assertPriceChangePolicy(linesOf(rawItem(item, 1, 85)), variantMapOf(item), locked)
        );
        assert.match(String(err), /not allowed to change the unit price of Rice 5kg/);
        assert.match(String(err), /price list: 100\.00 \/ 110\.00 \/ 90\.00, entered: 85\.00/);
    });

    it("rejects a price raised above the price list, not just lowered", () => {
        assert.throws(
            () => assertPriceChangePolicy(linesOf(rawItem(item, 1, 500)), variantMapOf(item), locked),
            /not allowed to change the unit price/
        );
    });

    it("allows anything once the setting is on", () => {
        assert.doesNotThrow(() =>
            assertPriceChangePolicy(linesOf(rawItem(item, 1, 85)), variantMapOf(item), cashierPolicy())
        );
    });

    it("never applies to an administrator", () => {
        assert.doesNotThrow(() =>
            assertPriceChangePolicy(
                linesOf(rawItem(item, 1, 85)),
                variantMapOf(item),
                cashierPolicy({ allowPriceChange: false, exempt: true })
            )
        );
    });

    it("never applies to a returned line", () => {
        // A refund pays back what the customer was charged, whatever that was.
        assert.doesNotThrow(() =>
            assertPriceChangePolicy(linesOf(rawItem(item, -1, 73)), variantMapOf(item), locked)
        );
    });
});

describe("Max Cashier Discount Limit (%)", () => {
    const item = variant({ name: "Sugar", price: 200, avgCostPrice: 20 });
    const capped = cashierPolicy({ maxDiscountPercent: 10 });

    it("measures a line discount against its unit price", () => {
        assert.equal(discountPercentOf(linesOf(rawItem(item, 1, 200, 20))[0]), 10);
        assert.equal(discountPercentOf(linesOf(rawItem(item, 1, 200, 50))[0]), 25);
        assert.equal(discountPercentOf(linesOf(rawItem(item, 1, 200, 0))[0]), 0);
    });

    it("accepts a discount exactly on the limit", () => {
        assert.doesNotThrow(() =>
            assertLineDiscountLimit(linesOf(rawItem(item, 3, 200, 20)), variantMapOf(item), capped)
        );
    });

    it("rejects a line discounted past the limit", () => {
        const err = errorFrom(() =>
            assertLineDiscountLimit(linesOf(rawItem(item, 1, 200, 40)), variantMapOf(item), capped)
        );
        assert.match(String(err), /Discount on Sugar is 20\.00%, above your 10% limit/);
    });

    it("does not reject a limit-exact discount over a floating point artefact", () => {
        // 33.33 x 10% = 3.333, which is not exactly representable.
        const odd = variant({ name: "Odd", price: 33.33, avgCostPrice: 1 });
        assert.doesNotThrow(() =>
            assertLineDiscountLimit(linesOf(rawItem(odd, 1, 33.33, 3.333)), variantMapOf(odd), capped)
        );
    });

    it("caps the invoice discount by the same percentage of the bill", () => {
        const lines = linesOf(rawItem(item, 5, 200)); // gross 1000
        assert.equal(sellingGross(lines), 1000);

        assert.doesNotThrow(() => assertInvoiceDiscountLimit(lines, 100, capped));
        const err = errorFrom(() => assertInvoiceDiscountLimit(lines, 101, capped));
        assert.match(String(err), /above your 10% limit \(maximum Rs 100\.00\)/);
    });

    it("ignores a zero or absent invoice discount", () => {
        const lines = linesOf(rawItem(item, 1, 200));
        assert.doesNotThrow(() => assertInvoiceDiscountLimit(lines, 0, capped));
    });

    it("counts only the selling lines when sizing the bill", () => {
        const returned = variant({ name: "Returned", price: 500, avgCostPrice: 10 });
        const lines = linesOf(rawItem(item, 5, 200), rawItem(returned, -1, 500));
        // The returned 500 must not inflate — or deflate — the discountable base.
        assert.equal(sellingGross(lines), 1000);
    });

    it("never applies to a pure return cart", () => {
        const lines = linesOf(rawItem(item, -2, 200, 190));
        assert.doesNotThrow(() => assertLineDiscountLimit(lines, variantMapOf(item), capped));
        assert.doesNotThrow(() => assertCashierPolicy({ lines, variantMap: variantMapOf(item), invoiceDiscount: 400, policy: capped }));
    });

    it("never applies to an administrator", () => {
        const exempt = cashierPolicy({ maxDiscountPercent: 10, exempt: true });
        const lines = linesOf(rawItem(item, 1, 200, 150));
        assert.doesNotThrow(() => assertLineDiscountLimit(lines, variantMapOf(item), exempt));
        assert.doesNotThrow(() => assertInvoiceDiscountLimit(lines, 5000, exempt));
    });

    it("does nothing when no limit is configured", () => {
        const lines = linesOf(rawItem(item, 1, 200, 199));
        assert.doesNotThrow(() => assertLineDiscountLimit(lines, variantMapOf(item), cashierPolicy()));
        assert.doesNotThrow(() => assertInvoiceDiscountLimit(lines, 5000, cashierPolicy()));
    });
});

describe("the rules reach the real sale pipeline", () => {
    const item = variant({ name: "Tea", price: 100, retail: 120, avgCostPrice: 40 });

    it("refuses a sale posted with an off-list price", () => {
        const err = errorFrom(() =>
            prepareCreateSale(
                ctx({
                    lines: linesOf(rawItem(item, 1, 55)),
                    variantMap: variantMapOf(item),
                    payments: [payment(55)],
                    policy: cashierPolicy({ allowPriceChange: false }),
                })
            )
        );
        assert.match(String(err), /not allowed to change the unit price of Tea/);
    });

    it("refuses a sale discounted past the cashier's limit", () => {
        const err = errorFrom(() =>
            prepareCreateSale(
                ctx({
                    lines: linesOf(rawItem(item, 1, 100, 30)),
                    variantMap: variantMapOf(item),
                    payments: [payment(70)],
                    policy: cashierPolicy({ maxDiscountPercent: 10 }),
                })
            )
        );
        assert.match(String(err), /Discount on Tea is 30\.00%, above your 10% limit/);
    });

    it("refuses an invoice discount past the limit", () => {
        const err = errorFrom(() =>
            prepareCreateSale(
                ctx({
                    lines: linesOf(rawItem(item, 2, 100)),
                    variantMap: variantMapOf(item),
                    discount: 50,
                    payments: [payment(150)],
                    policy: cashierPolicy({ maxDiscountPercent: 10 }),
                })
            )
        );
        assert.match(String(err), /above your 10% limit/);
    });

    it("allows the same sale within the limits", () => {
        assert.doesNotThrow(() =>
            prepareCreateSale(
                ctx({
                    lines: linesOf(rawItem(item, 2, 120, 12)),
                    variantMap: variantMapOf(item),
                    discount: 20,
                    payments: [payment(196)],
                    policy: cashierPolicy({ allowPriceChange: false, maxDiscountPercent: 10 }),
                })
            )
        );
    });

    it("does not restrict a return, whatever the price or discount", () => {
        const parent = parentSale({ id: 70, items: [{ variant: item, quantity: 4 }] });
        assert.doesNotThrow(() =>
            prepareReturnSale(
                ctx({
                    lines: linesOf(rawItem(item, -2, 47, 40)),
                    variantMap: variantMapOf(item),
                    parentSale: parent,
                    parentSaleId: 70,
                    payments: [payment(-14)],
                    policy: cashierPolicy({ allowPriceChange: false, maxDiscountPercent: 10 }),
                })
            )
        );
    });

    it("restricts only the selling half of an exchange", () => {
        const returned = variant({ name: "Old Tea", price: 100, avgCostPrice: 40 });
        const parent = parentSale({ id: 71, items: [{ variant: returned, quantity: 2 }] });
        const policy = cashierPolicy({ allowPriceChange: false, maxDiscountPercent: 10 });

        // The returned line is off-list and heavily discounted — still fine.
        assert.doesNotThrow(() =>
            prepareExchange(
                ctx({
                    lines: linesOf(rawItem(item, 1, 100), rawItem(returned, -1, 63, 20)),
                    variantMap: variantMapOf(item, returned),
                    parentSale: parent,
                    parentSaleId: 71,
                    payments: [payment(57)],
                    policy,
                })
            )
        );

        // The newly sold line is not.
        const err = errorFrom(() =>
            prepareExchange(
                ctx({
                    lines: linesOf(rawItem(item, 1, 77), rawItem(returned, -1, 100)),
                    variantMap: variantMapOf(item, returned),
                    parentSale: parent,
                    parentSaleId: 71,
                    payments: [payment(0)],
                    policy,
                })
            )
        );
        assert.match(String(err), /not allowed to change the unit price of Tea/);
    });

    it("leaves an administrator's sale alone", () => {
        // Off the price list and discounted 18%, which would fail both till
        // limits — but stays above the cost floor, which nobody is exempt from.
        assert.doesNotThrow(() =>
            prepareCreateSale(
                ctx({
                    lines: linesOf(rawItem(item, 1, 55, 10)),
                    variantMap: variantMapOf(item),
                    payments: [payment(45)],
                    policy: UNRESTRICTED,
                })
            )
        );
    });

    it("still holds an administrator to the cost price floor", () => {
        // The till limits are about what a cashier may override. Selling below
        // cost is a separate rule on the product, and it binds everyone.
        const err = errorFrom(() =>
            prepareCreateSale(
                ctx({
                    lines: linesOf(rawItem(item, 1, 55, 20)), // net 35, cost 40
                    variantMap: variantMapOf(item),
                    payments: [payment(35)],
                    policy: UNRESTRICTED,
                })
            )
        );
        assert.match(String(err), /below cost price for Tea/);
    });
});
