import { round2 } from "../../utils";
import type { PreparedItem, PreparedPayment, RawPaymentInput, SaleLine, SaleTotals, VariantMap } from "./types";

/** Net line total: (unitPrice - perUnitDiscount) * qty. Negative for return lines. */
export const lineTotal = (line: SaleLine): number =>
    round2((round2(line.unitPrice) - round2(line.discount)) * line.qty);

/** Sum of all line totals before invoice-level discount and tax. */
export const linesSubtotal = (lines: SaleLine[]): number =>
    lines.reduce((sum, line) => round2(sum + lineTotal(line)), 0);

export const sumPayments = (payments: RawPaymentInput[] | null | undefined): number =>
    (payments ?? []).reduce((sum, p) => round2(sum + round2(Number(p.amount))), 0);

/**
 * Change is only ever handed back on money coming in. A refund leg must never
 * be reduced by "change", so callers pass allowChange=false for return carts.
 */
export function computeTotals(args: {
    lines: SaleLine[];
    discount: number;
    taxAmount: number;
    payments: RawPaymentInput[] | null | undefined;
    allowChange: boolean;
}): SaleTotals {
    const { lines, payments, allowChange } = args;
    const discount = round2(Number(args.discount) || 0);
    const taxAmount = round2(Number(args.taxAmount) || 0);

    const totalAmount = round2(linesSubtotal(lines) - discount + taxAmount);
    const paidAmount = sumPayments(payments);
    const changeAmount = allowChange ? round2(Math.max(0, paidAmount - totalAmount)) : 0;
    const netPaidAmount = round2(paidAmount - changeAmount);

    return {
        totalAmount,
        paidAmount,
        changeAmount,
        netPaidAmount,
        payments: distributeChange(payments ?? [], changeAmount),
    };
}

/** Deduct the change from the largest payment leg first, so cash absorbs it before card/bank legs. */
export function distributeChange(payments: RawPaymentInput[], changeAmount: number): PreparedPayment[] {
    const deductions = new Array(payments.length).fill(0);

    if (changeAmount > 0) {
        let remaining = changeAmount;
        const byAmountDesc = payments
            .map((p, idx) => ({ amount: round2(Number(p.amount)), idx }))
            .sort((a, b) => b.amount - a.amount);

        for (const leg of byAmountDesc) {
            const ded = round2(Math.min(leg.amount, remaining));
            deductions[leg.idx] = ded;
            remaining = round2(remaining - ded);
        }
    }

    return payments.map((p, idx) => ({
        accountId: p.accountId,
        amount: round2(Number(p.amount) - deductions[idx]),
        changeAmount: round2(deductions[idx]),
        note: (p.note as string | undefined) ?? null,
    }));
}

/**
 * Snapshot the cost of a variant onto the sale item so profit reports stay
 * correct even after the product's average cost moves.
 */
export function snapshotUnitCost(variant: { price: number; factor: number; product: { avgCostPrice: number } }): number {
    const avg = variant.product.avgCostPrice;
    const base = avg > 0 && Number.isFinite(avg) && avg < 1e9 ? avg : variant.price * 0.95;
    return round2(base * variant.factor);
}

export function buildItems(lines: SaleLine[], variantMap: VariantMap): PreparedItem[] {
    return lines.map((line) => {
        const variant = variantMap.get(line.variantId)!;
        const unitPrice = round2(line.unitPrice);
        const discount = round2(line.discount);
        return {
            variantId: line.variantId,
            quantity: line.qty,
            unitPrice,
            discount,
            totalPrice: round2((unitPrice - discount) * line.qty),
            avgCostPrice: snapshotUnitCost(variant),
        };
    });
}
