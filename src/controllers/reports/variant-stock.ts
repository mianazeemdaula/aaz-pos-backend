import { prisma } from "../../prisma/prisma";

export interface VariantUnit {
    name: string;
    factor: number;
}

/** Every product's variants, biggest pack first. */
export async function variantsByProduct(productIds: number[]): Promise<Map<number, VariantUnit[]>> {
    const rows = await prisma.productVariant.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, name: true, factor: true },
        orderBy: [{ factor: "desc" }, { id: "asc" }],
    });
    const map = new Map<number, VariantUnit[]>();
    for (const r of rows) {
        const list = map.get(r.productId) ?? [];
        list.push({ name: r.name, factor: r.factor || 1 });
        map.set(r.productId, list);
    }
    return map;
}

/**
 * Stock (held in base units) spelled out in the product's own packs, biggest first,
 * with what is left over in the base unit: 75 units with a 30-pack → "2 × 30ml + 15 × unit".
 * Zero or negative stock cannot be split into packs, so it is shown in the base unit.
 */
export function variantBreakdown(stock: number, variants: VariantUnit[]): string {
    const packs = variants.filter((v) => v.factor > 1).sort((a, b) => b.factor - a.factor);
    const baseName = variants.find((v) => v.factor === 1)?.name || "unit";

    if (stock <= 0) return `${stock} × ${baseName}`;

    const parts: string[] = [];
    let remaining = stock;
    for (const pack of packs) {
        const count = Math.floor(remaining / pack.factor);
        if (count > 0) {
            parts.push(`${count} × ${pack.name}`);
            remaining -= count * pack.factor;
        }
    }
    if (remaining > 0 || parts.length === 0) parts.push(`${remaining} × ${baseName}`);
    return parts.join(" + ");
}
