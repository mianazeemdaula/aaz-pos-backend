import { Request, Response } from "express";
import dayjs from "dayjs";
import { Prisma } from "../../generated/client/client";
import { prisma } from "../../prisma/prisma";

type BucketRow = { bucket: Date; sales: number; salesCount: number; purchases: number; expenses: number };
type ItemAggRow = { cogs: number; itemDiscounts: number };
type InventoryRow = {
    totalProducts: number;
    lowStockCount: number;
    outOfStockCount: number;
    totalInventoryValue: number;
};

/**
 * Sales, purchases and expenses bucketed by day or month in one round trip.
 *
 * The timestamps are stored without a zone and were previously bucketed in JS
 * with dayjs, which formats in the server's local zone. Shifting by the same
 * offset here keeps the chart buckets identical to what the screen showed
 * before.
 */
function bucketQuery(since: Date, grain: "day" | "month", tzOffsetMinutes: number) {
    const shift = Prisma.sql`make_interval(mins => ${tzOffsetMinutes})`;
    // Group on the truncated timestamp rather than on a formatted string:
    // date_trunc is measurably cheaper than to_char over ~38k rows, and the
    // caller only has to format 12 (or 7) results instead of every row.
    return prisma.$queryRaw<BucketRow[]>`
        select bucket,
               sum(sales)::float8            as "sales",
               sum("salesCount")::int        as "salesCount",
               sum(purchases)::float8        as "purchases",
               sum(expenses)::float8         as "expenses"
        from (
            select date_trunc(${grain}, "createdAt" + ${shift})               as bucket,
                   coalesce(sum("totalAmount"), 0)                            as sales,
                   count(*) filter (where "totalAmount" >= 0)                 as "salesCount",
                   0                                                          as purchases,
                   0                                                          as expenses
            from sales where "createdAt" >= ${since} group by 1
            union all
            select date_trunc(${grain}, date + ${shift}), 0, 0,
                   coalesce(sum("totalAmount"), 0), 0
            from purchases where date >= ${since} group by 1
            union all
            select date_trunc(${grain}, date + ${shift}), 0, 0, 0,
                   coalesce(sum(amount), 0)
            from expenses where date >= ${since} group by 1
        ) t
        group by bucket`;
}

/**
 * Render a bucket timestamp as the chart's key.
 *
 * The shift to local wall-clock already happened in SQL, so these must be
 * formatted in UTC — running them back through a local-time formatter would
 * apply the offset twice.
 */
function bucketKey(bucket: Date, grain: "day" | "month"): string {
    const iso = new Date(bucket).toISOString();
    return grain === "month" ? iso.slice(0, 7) : iso.slice(0, 10);
}

/** COGS and item-level discount for every sale on or after `since`. */
function saleItemAgg(since: Date) {
    return prisma.$queryRaw<ItemAggRow[]>`
        select coalesce(sum(si.quantity * si."avgCostPrice"), 0)::float8 as "cogs",
               coalesce(sum(si.discount * si.quantity), 0)::float8       as "itemDiscounts"
        from sale_items si
        join sales s on s.id = si."saleId"
        where s."createdAt" >= ${since}`;
}

/**
 * Inventory tiles. The CASE mirrors safeAvgCost(): trust avgCostPrice when it
 * is a sane positive number, otherwise fall back to 95% of the first variant's
 * price. NaN and Infinity both fail the range test, as they did in JS.
 */
function inventoryQuery() {
    return prisma.$queryRaw<InventoryRow[]>`
        select count(*)::int                                                          as "totalProducts",
               count(*) filter (where p."totalStock" > 0
                                  and p."totalStock" <= p."reorderLevel")::int        as "lowStockCount",
               count(*) filter (where p."totalStock" <= 0)::int                       as "outOfStockCount",
               coalesce(sum(p."totalStock" * case
                   when p."avgCostPrice" > 0 and p."avgCostPrice" < 1e9 then p."avgCostPrice"
                   else greatest(coalesce(fv.price, 0) * 0.95, 0)
               end), 0)::float8                                                       as "totalInventoryValue"
        from products p
        left join lateral (
            select pv.price from product_variants pv
            where pv."productId" = p.id order by pv.id asc limit 1
        ) fv on true
        where p.active = true`;
}

export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const now = dayjs();
        const startOfToday = now.startOf("day").toDate();
        const startOfYesterday = now.subtract(1, "day").startOf("day").toDate();
        const endOfYesterday = now.subtract(1, "day").endOf("day").toDate();
        const startOfThisMonth = now.startOf("month").toDate();
        const startOfLastMonth = now.subtract(1, "month").startOf("month").toDate();
        const endOfLastMonth = now.subtract(1, "month").endOf("month").toDate();
        const startOf7DaysAgo = now.subtract(6, "day").startOf("day").toDate();
        const startOf12MAgo = now.subtract(11, "month").startOf("month").toDate();
        // Minutes to add to a stored UTC timestamp to get local wall-clock time,
        // matching how dayjs used to format these dates on this server.
        const tzOffsetMinutes = -new Date().getTimezoneOffset();

        const [
            salesToday, returnsToday,
            salesYesterday, returnsYesterday,
            salesThisMonth, returnsThisMonth,
            purchasesThisMonth, expensesThisMonth,
            salesLastMonth, returnsLastMonth,
            purchasesLastMonth, expensesLastMonth,
            pendingReturns, totalCustomers, totalSuppliers, newCustomersThisMonth,
            dailyBuckets, monthlyBuckets,
            topVariantsRaw, topCustomersRaw,
            recentSales,
            monthItemAgg, todayItemAgg,
            inventoryAgg,
        ] = await Promise.all([
            // Today / Yesterday sales and returns
            prisma.sale.aggregate({ where: { createdAt: { gte: startOfToday }, totalAmount: { gte: 0 } }, _sum: { totalAmount: true, paidAmount: true }, _count: true }),
            prisma.sale.aggregate({ where: { createdAt: { gte: startOfToday }, totalAmount: { lt: 0 } }, _sum: { totalAmount: true, paidAmount: true }, _count: true }),
            prisma.sale.aggregate({ where: { createdAt: { gte: startOfYesterday, lte: endOfYesterday }, totalAmount: { gte: 0 } }, _sum: { totalAmount: true }, _count: true }),
            prisma.sale.aggregate({ where: { createdAt: { gte: startOfYesterday, lte: endOfYesterday }, totalAmount: { lt: 0 } }, _sum: { totalAmount: true }, _count: true }),
            // This month sales and returns
            prisma.sale.aggregate({ where: { createdAt: { gte: startOfThisMonth }, totalAmount: { gte: 0 } }, _sum: { totalAmount: true, paidAmount: true, discount: true, taxAmount: true }, _count: true }),
            prisma.sale.aggregate({ where: { createdAt: { gte: startOfThisMonth }, totalAmount: { lt: 0 } }, _sum: { totalAmount: true, paidAmount: true, discount: true, taxAmount: true }, _count: true }),
            prisma.purchase.aggregate({ where: { date: { gte: startOfThisMonth } }, _sum: { totalAmount: true, paidAmount: true }, _count: true }),
            prisma.expense.aggregate({ where: { date: { gte: startOfThisMonth } }, _sum: { amount: true }, _count: true }),
            // Last month sales and returns
            prisma.sale.aggregate({ where: { createdAt: { gte: startOfLastMonth, lte: endOfLastMonth }, totalAmount: { gte: 0 } }, _sum: { totalAmount: true }, _count: true }),
            prisma.sale.aggregate({ where: { createdAt: { gte: startOfLastMonth, lte: endOfLastMonth }, totalAmount: { lt: 0 } }, _sum: { totalAmount: true }, _count: true }),
            prisma.purchase.aggregate({ where: { date: { gte: startOfLastMonth, lte: endOfLastMonth } }, _sum: { totalAmount: true }, _count: true }),
            prisma.expense.aggregate({ where: { date: { gte: startOfLastMonth, lte: endOfLastMonth } }, _sum: { amount: true }, _count: true }),
            // Misc counts
            Promise.resolve(0 as number),
            prisma.customer.count({ where: { active: true } }),
            prisma.supplier.count({ where: { active: true } }),
            prisma.customer.count({ where: { active: true, createdAt: { gte: startOfThisMonth } } }),
            // Chart buckets. These used to be six findMany calls that pulled every
            // row of the window into memory — ~38k sale rows for the 12-month
            // chart alone — only to bucket them in JS. Postgres does the same
            // grouping and returns at most 36 rows.
            bucketQuery(startOf7DaysAgo, "day", tzOffsetMinutes),
            bucketQuery(startOf12MAgo, "month", tzOffsetMinutes),
            // Top 5 variants this month by revenue
            prisma.saleItem.groupBy({
                by: ["variantId"],
                where: { sale: { createdAt: { gte: startOfThisMonth } } },
                _sum: { quantity: true, totalPrice: true },
                orderBy: { _sum: { totalPrice: "desc" } },
                take: 5,
            }),
            // Top 5 customers this month by spend
            prisma.sale.groupBy({
                by: ["customerId"],
                where: { createdAt: { gte: startOfThisMonth }, customerId: { not: null } },
                _sum: { totalAmount: true },
                _count: { _all: true },
                orderBy: { _sum: { totalAmount: "desc" } },
                take: 5,
            }),
            // Recent 5 sales
            prisma.sale.findMany({
                orderBy: { createdAt: "desc" },
                take: 5,
                select: { id: true, createdAt: true, totalAmount: true, paidAmount: true, customer: { select: { name: true } } },
            }),
            // COGS and item-level discounts, summed in the database rather than
            // by pulling every sale_item of the month across the wire.
            saleItemAgg(startOfThisMonth),
            saleItemAgg(startOfToday),
            // Inventory tiles: counts and stock value, aggregated in SQL. This
            // previously loaded all ~7k active products plus a variant each.
            inventoryQuery(),
        ]);

        // ── Inventory stats (aggregated in SQL, see inventoryQuery)
        const inv = inventoryAgg[0] ?? { totalProducts: 0, lowStockCount: 0, outOfStockCount: 0, totalInventoryValue: 0 };
        const { totalProducts, lowStockCount, outOfStockCount, totalInventoryValue } = inv;

        // ── COGS
        const todayCOGS = todayItemAgg[0]?.cogs ?? 0;
        const monthCOGS = monthItemAgg[0]?.cogs ?? 0;

        // ── Growth helper (% change, 1 decimal)
        const growth = (current: number, previous: number): number => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 1000) / 10;
        };

        // ── 7-day chart — group by date string
        const dailyMap = new Map<string, { sales: number; salesCount: number; purchases: number; expenses: number }>();
        for (let i = 6; i >= 0; i--) {
            dailyMap.set(now.subtract(i, "day").format("YYYY-MM-DD"), { sales: 0, salesCount: 0, purchases: 0, expenses: 0 });
        }
        for (const b of dailyBuckets) {
            const e = dailyMap.get(bucketKey(b.bucket, "day"));
            if (e) {
                e.sales += b.sales;
                e.salesCount += b.salesCount;
                e.purchases += b.purchases;
                e.expenses += b.expenses;
            }
        }
        const dailyChart = Array.from(dailyMap.entries()).map(([date, v]) => ({ date, ...v }));

        // ── 12-month chart — group by YYYY-MM
        const monthlyMap = new Map<string, { sales: number; salesCount: number; purchases: number; expenses: number }>();
        for (let i = 11; i >= 0; i--) {
            monthlyMap.set(now.subtract(i, "month").format("YYYY-MM"), { sales: 0, salesCount: 0, purchases: 0, expenses: 0 });
        }
        for (const b of monthlyBuckets) {
            const e = monthlyMap.get(bucketKey(b.bucket, "month"));
            if (e) {
                e.sales += b.sales;
                e.salesCount += b.salesCount;
                e.purchases += b.purchases;
                e.expenses += b.expenses;
            }
        }
        const monthlyChart = Array.from(monthlyMap.entries()).map(([month, v]) => ({ month, ...v }));

        // ── Resolve top product variant names (secondary query)
        const variantIds = topVariantsRaw.map(v => v.variantId);
        const variantDetails = variantIds.length > 0
            ? await prisma.productVariant.findMany({
                where: { id: { in: variantIds } },
                select: { id: true, name: true, product: { select: { name: true } } },
            })
            : [];
        const variantMap = new Map(variantDetails.map(v => [v.id, v]));
        const topProducts = topVariantsRaw.map(v => ({
            variantId: v.variantId,
            productName: variantMap.get(v.variantId)?.product.name ?? "Unknown",
            variantName: variantMap.get(v.variantId)?.name ?? "",
            totalQty: v._sum.quantity ?? 0,
            totalRevenue: v._sum.totalPrice ?? 0,
        }));

        // ── Resolve top customer names (secondary query)
        const custIds = topCustomersRaw.map(c => c.customerId).filter((id): id is number => id != null);
        const custDetails = custIds.length > 0
            ? await prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } })
            : [];
        const custMap = new Map(custDetails.map(c => [c.id, c]));
        const topCustomers = topCustomersRaw.map(c => ({
            customerId: c.customerId,
            name: c.customerId ? (custMap.get(c.customerId)?.name ?? "Walk-in") : "Walk-in",
            totalSpent: c._sum.totalAmount ?? 0,
            transactions: c._count._all,
        }));

        // ── Numeric shortcuts
        const todaySalesTotal = (salesToday._sum.totalAmount ?? 0) + (returnsToday._sum.totalAmount ?? 0);
        const yesterdaySalesTotal = (salesYesterday._sum.totalAmount ?? 0) + (returnsYesterday._sum.totalAmount ?? 0);
        const monthSalesTotal = (salesThisMonth._sum.totalAmount ?? 0) + (returnsThisMonth._sum.totalAmount ?? 0);
        const lastMonthSalesTotal = (salesLastMonth._sum.totalAmount ?? 0) + (returnsLastMonth._sum.totalAmount ?? 0);
        const monthPurchasesTotal = purchasesThisMonth._sum.totalAmount ?? 0;
        const lastMonthPurchasesTotal = purchasesLastMonth._sum.totalAmount ?? 0;
        const monthExpensesTotal = expensesThisMonth._sum.amount ?? 0;
        const lastMonthExpensesTotal = expensesLastMonth._sum.amount ?? 0;

        const todayPaidAmount = (salesToday._sum.paidAmount ?? 0) + (returnsToday._sum.paidAmount ?? 0);
        const monthPaidAmount = (salesThisMonth._sum.paidAmount ?? 0) + (returnsThisMonth._sum.paidAmount ?? 0);
        const monthTaxAmount = (salesThisMonth._sum.taxAmount ?? 0) + (returnsThisMonth._sum.taxAmount ?? 0);
        const monthItemDiscounts = monthItemAgg[0]?.itemDiscounts ?? 0;
        const monthDiscountTotal = (salesThisMonth._sum.discount ?? 0) + (returnsThisMonth._sum.discount ?? 0) + monthItemDiscounts;

        res.json({
            today: {
                salesTotal: todaySalesTotal,
                salesCount: salesToday._count,
                paidAmount: todayPaidAmount,
                grossProfit: todaySalesTotal - todayCOGS,
                vsYesterday: {
                    salesTotal: yesterdaySalesTotal,
                    salesCount: salesYesterday._count,
                    salesGrowth: growth(todaySalesTotal, yesterdaySalesTotal),
                },
            },
            thisMonth: {
                salesTotal: monthSalesTotal,
                salesCount: salesThisMonth._count,
                paidAmount: monthPaidAmount,
                discount: monthDiscountTotal,
                taxAmount: monthTaxAmount,
                purchasesTotal: monthPurchasesTotal,
                purchasesCount: purchasesThisMonth._count,
                purchasesPaid: purchasesThisMonth._sum.paidAmount ?? 0,
                expensesTotal: monthExpensesTotal,
                expensesCount: expensesThisMonth._count,
                cogs: monthCOGS,
                grossProfit: monthSalesTotal - monthCOGS,
                netProfit: monthSalesTotal - monthCOGS - monthExpensesTotal,
            },
            lastMonth: {
                salesTotal: lastMonthSalesTotal,
                salesCount: salesLastMonth._count,
                purchasesTotal: lastMonthPurchasesTotal,
                purchasesCount: purchasesLastMonth._count,
                expensesTotal: lastMonthExpensesTotal,
                expensesCount: expensesLastMonth._count,
            },
            changes: {
                salesGrowth: growth(monthSalesTotal, lastMonthSalesTotal),
                purchasesChange: growth(monthPurchasesTotal, lastMonthPurchasesTotal),
                expensesChange: growth(monthExpensesTotal, lastMonthExpensesTotal),
            },
            inventory: {
                totalProducts,
                lowStockCount,
                outOfStockCount,
                totalInventoryValue,
            },
            customers: {
                total: totalCustomers,
                newThisMonth: newCustomersThisMonth,
            },
            suppliers: {
                total: totalSuppliers,
            },
            pendingReturns,
            charts: {
                daily: dailyChart,
                monthly: monthlyChart,
            },
            topProducts,
            topCustomers,
            recentSales: recentSales.map(s => ({
                id: s.id,
                date: s.createdAt,
                customer: s.customer?.name ?? "Walk-in",
                total: s.totalAmount,
                paid: s.paidAmount,
                due: s.totalAmount - s.paidAmount,
            })),
        });
    } catch (err) {
        console.error("Dashboard stats error:", err);
        res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
};
