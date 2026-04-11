/**
 * One-time data repair script: reset corrupted avgCostPrice values.
 *
 * Corruption occurs when the weighted-average formula was applied while
 * product.totalStock was negative, causing the value to compound into
 * astronomically large (positive or negative) numbers.
 *
 * This script resets any product whose avgCostPrice is:
 *   - <= 0 (can't have negative or zero cost if the product was purchased)
 *   - >= 1,000,000,000 (1 billion — clearly a compounding artifact)
 *
 * For those products the avgCostPrice is set to 95% of their default variant's
 * sale price, which is the same fallback the application uses when no cost is
 * available.
 *
 * Run with:
 *   cd pos-backend
 *   npx ts-node scripts/fix-avg-cost.ts
 */

import { PrismaClient } from "../src/generated/client";

const prisma = new PrismaClient();

async function main() {
    const products = await prisma.product.findMany({
        where: { active: true },
        select: {
            id: true,
            name: true,
            avgCostPrice: true,
            variants: { select: { price: true }, orderBy: { id: "asc" }, take: 1 },
        },
    });

    let fixed = 0;
    for (const p of products) {
        const avg = p.avgCostPrice;
        const isCorrupted = avg <= 0 || !isFinite(avg) || avg >= 1e9;
        if (!isCorrupted) continue;

        const variantPrice = p.variants[0]?.price ?? 0;
        const resetTo = variantPrice > 0 ? variantPrice * 0.95 : 0;

        await prisma.product.update({
            where: { id: p.id },
            data: { avgCostPrice: resetTo },
        });

        console.log(
            `Fixed: "${p.name}" — avgCostPrice ${avg} → ${resetTo.toFixed(4)}`
        );
        fixed++;
    }

    console.log(`\nDone. Fixed ${fixed} of ${products.length} products.`);
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
