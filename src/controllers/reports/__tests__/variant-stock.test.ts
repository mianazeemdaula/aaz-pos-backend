import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { variantBreakdown } from "../variant-stock";

describe("variantBreakdown", () => {
    const unit = { name: "unit", factor: 1 };
    const pack30 = { name: "30ml", factor: 30 };
    const box12 = { name: "Box", factor: 12 };

    it("splits stock into packs and loose units", () => {
        assert.equal(variantBreakdown(75, [unit, pack30]), "2 × 30ml + 15 × unit");
    });

    it("uses the biggest pack first", () => {
        assert.equal(variantBreakdown(43, [unit, box12, pack30]), "1 × 30ml + 1 × Box + 1 × unit");
    });

    it("leaves out the loose part when packs divide evenly", () => {
        assert.equal(variantBreakdown(60, [unit, pack30]), "2 × 30ml");
    });

    it("shows a single-variant product in its unit", () => {
        assert.equal(variantBreakdown(7, [unit]), "7 × unit");
    });

    it("keeps zero and negative stock in the base unit", () => {
        assert.equal(variantBreakdown(0, [unit, pack30]), "0 × unit");
        assert.equal(variantBreakdown(-4, [unit, pack30]), "-4 × unit");
    });

    it("falls back to 'unit' when the product has no base variant", () => {
        assert.equal(variantBreakdown(35, [pack30]), "1 × 30ml + 5 × unit");
    });
});
