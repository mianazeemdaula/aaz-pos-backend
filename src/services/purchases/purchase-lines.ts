import { round2 } from "../../utils";

/** A purchase line as the client sends it: quantity and unitCost are per entered unit (variant). */
export interface RawPurchaseItem {
    productId: unknown;
    quantity: unknown;
    unitCost: unknown;
    factor?: unknown;
    discount?: unknown;
    taxAmount?: unknown;
    sellingPrice?: unknown;
}

/**
 * A parsed line. `quantity` is in base units (entered qty × variant factor);
 * `originalQty` and `unitCost` stay in the entered unit, which is how the bill is priced.
 */
export interface PurchaseLine {
    productId: number;
    quantity: number;
    originalQty: number;
    factor: number;
    unitCost: number;
    discount: number;
    taxAmount: number;
    sellingPrice: number;
}

export function parsePurchaseItems(items: RawPurchaseItem[]): PurchaseLine[] {
    return items.map((i) => {
        const factor = i.factor && Number(i.factor) > 0 ? Number(i.factor) : 1;
        const originalQty = Number(i.quantity);
        return {
            productId: Number(i.productId),
            quantity: originalQty * factor,
            originalQty,
            factor,
            unitCost: Number(i.unitCost),
            discount: Number(i.discount ?? 0),
            taxAmount: Number(i.taxAmount ?? 0),
            sellingPrice: Number(i.sellingPrice ?? 0),
        };
    });
}

/** First validation problem in the lines, or null when they are all usable. */
export function validatePurchaseLines(lines: PurchaseLine[]): string | null {
    for (const item of lines) {
        if (!item.productId || isNaN(item.productId) || item.productId <= 0) {
            return "Each item must have a valid productId";
        }
        if (isNaN(item.originalQty) || item.originalQty === 0) {
            return `Invalid quantity for productId ${item.productId}`;
        }
        if (isNaN(item.unitCost) || item.unitCost < 0) {
            return `Invalid unitCost for productId ${item.productId}`;
        }
    }
    return null;
}

/** Line total as stored on purchase_items: (unitCost - discount) × qty + tax. */
export function lineTotalCost(item: PurchaseLine): number {
    return round2((round2(item.unitCost) - round2(item.discount)) * item.originalQty + round2(item.taxAmount));
}

/** Cost of one base unit, which is what purchase_items.unitCost and product.avgCostPrice hold. */
export function baseUnitCost(item: PurchaseLine): number {
    return round2(item.unitCost / item.factor);
}

export function purchaseTotal(
    lines: PurchaseLine[],
    invoice: { discount: number; taxAmount: number; expenses: number },
): number {
    // Rounds the net line before adding tax, exactly as purchases have always been totalled.
    const itemsTotal = lines.reduce(
        (sum, item) => round2(sum + round2((round2(item.unitCost) - round2(item.discount)) * item.originalQty) + round2(item.taxAmount)),
        0,
    );
    return round2(itemsTotal - round2(invoice.discount) + round2(invoice.taxAmount) + round2(invoice.expenses));
}

export function purchaseItemRows(lines: PurchaseLine[]) {
    return lines.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitCost: baseUnitCost(item),
        sellingPrice: round2(item.sellingPrice ?? 0),
        discount: round2(item.discount ?? 0),
        taxAmount: round2(item.taxAmount ?? 0),
        totalCost: lineTotalCost(item),
    }));
}

/**
 * Weighted average cost after receiving `qty` base units at `unitCost`.
 * Matches what a new purchase has always done: when the stock on hand is zero or
 * negative (oversold) there is nothing to average against, so the new cost wins.
 */
export function receiveAvgCost(stock: number, avgCost: number, qty: number, unitCost: number): number {
    const newStock = stock + qty;
    if (stock > 0 && newStock > 0) return round2((avgCost * stock + unitCost * qty) / newStock);
    return unitCost;
}
