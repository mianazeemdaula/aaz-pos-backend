import { prisma } from "../../prisma/prisma";
import type { ParentSaleSnapshot, SaleLine, SalePlan, VariantMap, VariantSnapshot } from "./types";
import { badRequest } from "./errors";
import { uniqueVariantIds } from "./sale-lines";
import { ledgerPosting, stockPostings } from "./sale-postings";
import { resolveCashierPolicy, UNRESTRICTED, type CashierPolicy } from "./cashier-policy";
import { loadUserSettings } from "../auth/permission-store";

/** Load the variants referenced by the cart. Throws if any is missing. */
export async function loadVariants(lines: SaleLine[]): Promise<VariantMap> {
    const ids = uniqueVariantIds(lines);
    const variants = await prisma.productVariant.findMany({
        where: { id: { in: ids } },
        include: { product: true },
    });

    if (variants.length !== ids.length) throw badRequest("One or more variants not found");

    return new Map<number, VariantSnapshot>(
        variants.map((v: any) => [
            v.id,
            {
                id: v.id,
                productId: v.productId,
                price: v.price,
                retail: v.retail,
                wholesale: v.wholesale,
                factor: v.factor,
                product: {
                    id: v.product.id,
                    name: v.product.name,
                    avgCostPrice: v.product.avgCostPrice ?? 0,
                    saleBelowCost: v.product.saleBelowCost,
                    isService: v.product.isService ?? false,
                },
            },
        ])
    );
}

/** Load the original invoice a return is booked against, in the shape the return rules expect. */
export async function loadParentSale(parentSaleId: number): Promise<ParentSaleSnapshot | null> {
    const sale = await prisma.sale.findUnique({
        where: { id: parentSaleId },
        include: {
            items: { include: { variant: { include: { product: true } } } },
            returns: { include: { items: true } },
        },
    });
    if (!sale) return null;

    return {
        id: sale.id,
        totalAmount: sale.totalAmount,
        items: sale.items.map((i: any) => ({
            variantId: i.variantId,
            quantity: i.quantity,
            variant: { product: { name: i.variant.product.name } },
        })),
        returns: sale.returns.map((r: any) => ({
            items: r.items.map((ri: any) => ({ variantId: ri.variantId, quantity: ri.quantity })),
        })),
    };
}

const saleInclude = {
    items: true,
    payments: { include: { account: true } },
    customer: true,
} as const;

/**
 * Write the prepared transaction: the sale row, its items and payments, the
 * stock movements and the customer ledger entry — all in one DB transaction.
 * Shared by the create-sale and return-sale services; the plan already encodes
 * every difference between them.
 */
export async function persistSalePlan(plan: SalePlan) {
    return prisma.$transaction(async (tx) => {
        const sale = await tx.sale.create({
            data: {
                customerId: plan.customerId,
                userId: plan.userId,
                totalAmount: plan.totals.totalAmount,
                paidAmount: plan.totals.netPaidAmount,
                taxAmount: plan.taxAmount,
                discount: plan.discount,
                changeAmount: plan.totals.changeAmount,
                note: plan.note,
                parentSaleId: plan.parentSaleId,
                items: { create: plan.items },
                payments: { create: plan.totals.payments },
            },
            include: saleInclude,
        });

        for (const posting of stockPostings(plan)) {
            // Decrementing by a negative qty puts the stock back.
            await tx.product.update({
                where: { id: posting.productId },
                data: { totalStock: { decrement: posting.decrementBy } },
            });

            await tx.stockMovement.create({
                data: {
                    productId: posting.productId,
                    type: posting.type,
                    quantity: posting.quantity, // positive for returns, negative for sales
                    reference: `${posting.referencePrefix}-${sale.id}`,
                    referenceId: sale.id,
                },
            });
        }

        const ledger = ledgerPosting(plan, sale.id);
        if (ledger) {
            await tx.customerLedger.create({
                data: {
                    customerId: ledger.customerId,
                    type: ledger.type,
                    amount: ledger.amount,
                    debit: ledger.debit,
                    credit: ledger.credit,
                    referenceId: sale.id,
                    reference: ledger.message,
                },
            });
        }

        return sale;
    });
}

/** Global app settings — the un-prefixed rows in the settings table. */
export async function loadAppSettings(): Promise<Record<string, unknown>> {
    const rows = await prisma.setting.findMany({ where: { key: { not: { startsWith: "user." } } } });

    const map: Record<string, unknown> = {};
    for (const row of rows) {
        if (row.type === "boolean") map[row.key] = row.value === "true";
        else if (row.type === "number") map[row.key] = Number(row.value);
        else map[row.key] = row.value;
    }
    return map;
}

/**
 * The till limits for the user posting a sale: the global rules, any per-user
 * override, and their live role. Falls back to unrestricted if settings cannot
 * be read — a settings outage must never stop a shop selling.
 */
export async function loadCashierPolicy(userId: number | null): Promise<CashierPolicy> {
    if (userId == null) return UNRESTRICTED;

    try {
        const [appSettings, userSettings, user] = await Promise.all([
            loadAppSettings(),
            loadUserSettings(userId),
            prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
        ]);
        return resolveCashierPolicy({ role: user?.role, appSettings, userSettings });
    } catch (err) {
        console.error("Failed to load cashier policy, allowing the sale:", err);
        return UNRESTRICTED;
    }
}
