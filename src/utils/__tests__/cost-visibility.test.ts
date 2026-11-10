import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { forRole, withoutCosts } from "../cost-visibility";

const sale = {
    id: 7,
    createdAt: new Date("2026-10-19T10:00:00Z"),
    totalAmount: 3000,
    items: [
        {
            id: 1,
            quantity: 2,
            unitPrice: 1500,
            avgCostPrice: 900,
            variant: { id: 3, name: "unit", product: { id: 4, name: "Mango", avgCostPrice: 900, totalStock: 5 } },
        },
    ],
    returns: [{ id: 8, items: [{ id: 2, quantity: -1, avgCostPrice: 900 }] }],
};

describe("cost visibility", () => {
    it("removes cost from sale lines, their products and their returns", () => {
        const out = withoutCosts(sale);
        assert.equal("avgCostPrice" in out.items[0], false);
        assert.equal("avgCostPrice" in out.items[0].variant.product, false);
        assert.equal("avgCostPrice" in out.returns[0].items[0], false);
    });

    it("keeps everything else, including dates", () => {
        const out = withoutCosts(sale);
        assert.equal(out.items[0].unitPrice, 1500);
        assert.equal(out.items[0].variant.product.totalStock, 5);
        assert.ok(out.createdAt instanceof Date);
        assert.equal(out.createdAt.toISOString(), "2026-10-19T10:00:00.000Z");
    });

    it("does not modify the original object", () => {
        withoutCosts(sale);
        assert.equal(sale.items[0].avgCostPrice, 900);
    });

    it("shows costs to admins only", () => {
        assert.equal(forRole("ADMIN", sale).items[0].avgCostPrice, 900);
        for (const role of ["MANAGER", "CASHIER", "WORKER", undefined]) {
            assert.equal("avgCostPrice" in forRole(role, sale).items[0], false);
        }
    });
});
