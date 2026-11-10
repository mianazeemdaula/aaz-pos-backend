import type { Prisma } from "../../generated/client/client";
import { round2 } from "../../utils";
import {
    type PurchaseLine, type RawPurchaseItem,
    parsePurchaseItems, validatePurchaseLines, purchaseTotal, purchaseItemRows, baseUnitCost, receiveAvgCost,
} from "./purchase-lines";

export class PurchaseEditError extends Error {
    constructor(message: string, readonly status = 400) {
        super(message);
    }
}

export interface EditPurchaseInput {
    invoiceNo?: string | null;
    supplierId?: number | null;
    note?: string | null;
    discount?: number;
    taxAmount?: number;
    expenses?: number;
    items: RawPurchaseItem[];
    payments?: { accountId: number; amount: number; note?: string }[];
}

/** Base units received for one product on a purchase and what they cost in total. */
export interface Receipt {
    qty: number;
    value: number;
}

export function receiptsByProduct(rows: { productId: number; quantity: number; unitCost: number }[]): Map<number, Receipt> {
    const map = new Map<number, Receipt>();
    for (const r of rows) {
        const cur = map.get(r.productId) ?? { qty: 0, value: 0 };
        map.set(r.productId, { qty: cur.qty + r.quantity, value: cur.value + r.quantity * r.unitCost });
    }
    return map;
}

/**
 * Stock and average cost of a product once one purchase's receipt is swapped from
 * `before` to `after`. The old receipt is backed out of the stock value, then the new
 * one is received exactly as a fresh purchase would be.
 *
 * Sales made since the purchase keep the cost they were booked at; only stock on hand
 * is revalued.
 */
export function reviseProductStock(
    product: { totalStock: number; avgCostPrice: number },
    before: Receipt,
    after: Receipt,
): { totalStock: number; avgCostPrice: number } {
    if (before.qty === after.qty && round2(before.value) === round2(after.value)) {
        return { totalStock: product.totalStock, avgCostPrice: product.avgCostPrice };
    }

    const stockWithout = product.totalStock - before.qty;
    let avgWithout = product.avgCostPrice;
    if (before.qty !== 0 && product.totalStock > 0 && stockWithout > 0) {
        const valueWithout = product.avgCostPrice * product.totalStock - before.value;
        // A negative remainder means sales already used up this purchase's cost; keep the current average.
        if (valueWithout > 0) avgWithout = valueWithout / stockWithout;
    }

    if (after.qty <= 0) {
        return { totalStock: stockWithout, avgCostPrice: round2(avgWithout) };
    }
    return {
        totalStock: stockWithout + after.qty,
        avgCostPrice: round2(receiveAvgCost(stockWithout, avgWithout, after.qty, after.value / after.qty)),
    };
}

/** Units of each product already sent back to the supplier against this purchase. */
function returnedByProduct(returns: { items: { productId: number; quantity: number }[] }[]): Map<number, number> {
    const map = new Map<number, number>();
    for (const ret of returns) {
        for (const item of ret.items) {
            map.set(item.productId, (map.get(item.productId) ?? 0) + Math.abs(item.quantity));
        }
    }
    return map;
}

/**
 * Rewrite a saved purchase in place and bring everything it touched back in line:
 * product stock and average cost, the PO's stock movements, its payments (which drive
 * account balances) and the supplier ledger. Everything keeps the purchase's original
 * dates so reports and running balances stay in order.
 */
export async function editPurchase(tx: Prisma.TransactionClient, id: number, input: EditPurchaseInput) {
    const purchase = await tx.purchase.findUnique({
        where: { id },
        include: {
            items: true,
            payments: true,
            returns: { include: { items: true } },
        },
    });
    if (!purchase) throw new PurchaseEditError("Purchase not found", 404);
    if (purchase.parentPurchaseId || purchase.totalAmount < 0) {
        throw new PurchaseEditError("Purchase returns cannot be edited");
    }

    if (!input.items?.length) throw new PurchaseEditError("items are required");
    const lines: PurchaseLine[] = parsePurchaseItems(input.items);
    const invalid = validatePurchaseLines(lines);
    if (invalid) throw new PurchaseEditError(invalid);
    if (lines.some((l) => l.quantity < 0)) {
        throw new PurchaseEditError("Quantities must be positive. Use Purchase Return to send stock back.");
    }

    const newReceipts = receiptsByProduct(lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: baseUnitCost(l) })));
    const oldReceipts = receiptsByProduct(purchase.items);

    // Stock already returned to the supplier against this PO must still be covered.
    for (const [productId, returned] of returnedByProduct(purchase.returns)) {
        const kept = newReceipts.get(productId)?.qty ?? 0;
        if (kept < returned) {
            throw new PurchaseEditError(
                `Product ID ${productId}: ${returned} unit(s) were already returned against this purchase, so it cannot be reduced below ${returned}.`,
            );
        }
    }

    const productIds = Array.from(new Set([...oldReceipts.keys(), ...newReceipts.keys()]));
    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    if (products.length !== productIds.length) throw new PurchaseEditError("One or more products not found");

    const supplierId = input.supplierId === undefined ? purchase.supplierId : input.supplierId ? Number(input.supplierId) : null;
    const discount = round2(Number(input.discount ?? 0));
    const taxAmount = round2(Number(input.taxAmount ?? 0));
    const expenses = round2(Number(input.expenses ?? 0));
    const payments = (input.payments ?? [])
        .map((p) => ({ accountId: Number(p.accountId), amount: round2(Number(p.amount)), note: p.note }))
        .filter((p) => p.accountId && p.amount !== 0);
    const paidAmount = round2(payments.reduce((s, p) => s + p.amount, 0));
    const totalAmount = purchaseTotal(lines, { discount, taxAmount, expenses });

    if (totalAmount !== paidAmount && !supplierId) {
        throw new PurchaseEditError("Supplier must be selected if amount not fully paid");
    }

    // ── Stock and average cost
    for (const product of products) {
        const next = reviseProductStock(
            product,
            oldReceipts.get(product.id) ?? { qty: 0, value: 0 },
            newReceipts.get(product.id) ?? { qty: 0, value: 0 },
        );
        if (next.totalStock !== product.totalStock || next.avgCostPrice !== product.avgCostPrice) {
            await tx.product.update({ where: { id: product.id }, data: next });
        }
    }

    // ── Stock movements: replace this PO's receipts, keeping their original timestamp
    const oldMovement = await tx.stockMovement.findFirst({
        where: { referenceId: id, type: "PURCHASE" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
    });
    await tx.stockMovement.deleteMany({ where: { referenceId: id, type: "PURCHASE" } });
    await tx.stockMovement.createMany({
        data: lines.map((l) => ({
            productId: l.productId,
            type: "PURCHASE" as const,
            quantity: l.quantity,
            reference: `PO-${id}`,
            referenceId: id,
            createdAt: oldMovement?.createdAt ?? purchase.createdAt,
        })),
    });

    // ── Items and payments (account balances are summed from purchase_payments)
    const paymentsAt = purchase.payments.reduce<Date>(
        (earliest, p) => (p.createdAt < earliest ? p.createdAt : earliest),
        purchase.createdAt,
    );
    await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
    await tx.purchasePayment.deleteMany({ where: { purchaseId: id } });

    // ── Supplier ledger: one bill entry per PO, rewritten for the (possibly new) supplier.
    // Overpaid bills are booked as PURCHASE_RETURN against the same PO id, so clear both.
    const billEntries = purchase.supplierId
        ? { supplierId: purchase.supplierId, referenceId: id, type: { in: ["PURCHASE", "PURCHASE_RETURN"] as ("PURCHASE" | "PURCHASE_RETURN")[] } }
        : null;
    const oldLedger = billEntries
        ? await tx.supplierLedger.findFirst({ where: billEntries, orderBy: { createdAt: "asc" }, select: { createdAt: true } })
        : null;
    if (billEntries) await tx.supplierLedger.deleteMany({ where: billEntries });
    const amountDue = round2(totalAmount - paidAmount);
    if (supplierId && amountDue !== 0) {
        const isCredit = amountDue < 0;
        await tx.supplierLedger.create({
            data: {
                supplierId,
                type: isCredit ? "PURCHASE_RETURN" : "PURCHASE",
                amount: Math.abs(amountDue),
                debit: isCredit ? 0 : Math.abs(amountDue),
                credit: isCredit ? Math.abs(amountDue) : 0,
                referenceId: id,
                reference: isCredit
                    ? `Supplier returned items worth Rs ${Math.abs(amountDue)}`
                    : `Bill amount Rs ${totalAmount} with payments Rs ${paidAmount} Purchase Order # ${id}`,
                note: "Edited",
                createdAt: oldLedger?.createdAt ?? purchase.createdAt,
            },
        });
    }

    return tx.purchase.update({
        where: { id },
        data: {
            invoiceNo: input.invoiceNo === undefined ? purchase.invoiceNo : input.invoiceNo || null,
            supplierId,
            accountId: payments[0]?.accountId ?? null,
            totalAmount,
            paidAmount,
            discount,
            taxAmount,
            expenses,
            note: input.note === undefined ? purchase.note : input.note ? String(input.note) : null,
            items: { create: purchaseItemRows(lines) },
            payments: payments.length
                ? { create: payments.map((p) => ({ accountId: p.accountId, amount: p.amount, note: p.note, createdAt: paymentsAt })) }
                : undefined,
        },
        include: { items: true, account: true, supplier: true, payments: { include: { account: true } } },
    });
}
