import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { receiptsByProduct, reviseProductStock } from "../edit-purchase";
import { parsePurchaseItems, purchaseItemRows, purchaseTotal } from "../purchase-lines";

describe("edit-purchase: stock and average cost", () => {
    it("leaves a product untouched when its lines did not change", () => {
        const product = { totalStock: 7, avgCostPrice: 103.33 };
        assert.deepEqual(reviseProductStock(product, { qty: 10, value: 1000 }, { qty: 10, value: 1000 }), product);
    });

    it("moves stock by the change in quantity", () => {
        // Bought 10, sold 3 → 7 on hand. The bill should have said 12.
        const next = reviseProductStock({ totalStock: 7, avgCostPrice: 100 }, { qty: 10, value: 1000 }, { qty: 12, value: 1200 });
        assert.equal(next.totalStock, 9);
        assert.equal(next.avgCostPrice, 100);
    });

    it("re-averages against the stock that was there before the purchase", () => {
        // 10 @ 50 on hand, then a PO of 10 @ 100 → 20 @ 75. Correct the PO cost to 80 → 20 @ 65.
        const next = reviseProductStock({ totalStock: 20, avgCostPrice: 75 }, { qty: 10, value: 1000 }, { qty: 10, value: 800 });
        assert.equal(next.totalStock, 20);
        assert.equal(next.avgCostPrice, 65);
    });

    it("backs the receipt out completely when the product is removed from the bill", () => {
        const next = reviseProductStock({ totalStock: 20, avgCostPrice: 75 }, { qty: 10, value: 1000 }, { qty: 0, value: 0 });
        assert.equal(next.totalStock, 10);
        assert.equal(next.avgCostPrice, 50);
    });

    it("receives a product newly added to the bill like a fresh purchase", () => {
        const next = reviseProductStock({ totalStock: 4, avgCostPrice: 50 }, { qty: 0, value: 0 }, { qty: 6, value: 600 });
        assert.equal(next.totalStock, 10);
        assert.equal(next.avgCostPrice, 80);
    });

    it("lets stock go negative when the corrected bill is less than what was already sold", () => {
        // Entered 100 by mistake, sold 20, real bill was 10.
        const next = reviseProductStock({ totalStock: 80, avgCostPrice: 10 }, { qty: 100, value: 1000 }, { qty: 10, value: 100 });
        assert.equal(next.totalStock, -10);
        assert.equal(next.avgCostPrice, 10);
    });

    it("takes the new cost when nothing older is left on hand to average with", () => {
        // Bought 10 @ 100, sold all but 2. Correct the cost to 90.
        const next = reviseProductStock({ totalStock: 2, avgCostPrice: 100 }, { qty: 10, value: 1000 }, { qty: 10, value: 900 });
        assert.equal(next.totalStock, 2);
        assert.equal(next.avgCostPrice, 90);
    });

    it("sums several lines of the same product", () => {
        const map = receiptsByProduct([
            { productId: 1, quantity: 2, unitCost: 10 },
            { productId: 1, quantity: 3, unitCost: 20 },
            { productId: 2, quantity: 1, unitCost: 5 },
        ]);
        assert.deepEqual(map.get(1), { qty: 5, value: 80 });
        assert.deepEqual(map.get(2), { qty: 1, value: 5 });
    });
});

describe("purchase-lines", () => {
    it("stores pack lines in base units at base-unit cost", () => {
        // 2 boxes of 12 at Rs 120 a box, Rs 12 off each box.
        const lines = parsePurchaseItems([{ productId: 1, quantity: 2, unitCost: 120, factor: 12, discount: 12 }]);
        const [row] = purchaseItemRows(lines);
        assert.equal(row.quantity, 24);
        assert.equal(row.unitCost, 10);
        assert.equal(row.totalCost, 216);
    });

    it("totals lines, then applies invoice discount, tax and expenses", () => {
        const lines = parsePurchaseItems([
            { productId: 1, quantity: 3, unitCost: 100, discount: 10 },
            { productId: 2, quantity: 1, unitCost: 50 },
        ]);
        assert.equal(purchaseTotal(lines, { discount: 20, taxAmount: 5, expenses: 15 }), 320);
    });
});
