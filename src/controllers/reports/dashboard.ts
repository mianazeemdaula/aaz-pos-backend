import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import { safeAvgCost } from "./helpers";

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

        const [
            salesToday, returnsToday,
            salesYesterday, returnsYesterday,
            salesThisMonth, returnsThisMonth,
            purchasesThisMonth, expensesThisMonth,
            salesLastMonth, returnsLastMonth,
            purchasesLastMonth, expensesLastMonth,
            pendingReturns, totalCustomers, totalSuppliers, newCustomersThisMonth,
            salesLast7Days, purchasesLast7Days, expensesLast7Days,
            salesLast12M, purchasesLast12M, expensesLast12M,
            topVariantsRaw, topCustomersRaw,
            recentSales,
            monthSaleItems, todaySaleItems,
            allActiveProducts,
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
            // 7-day chart (individual records grouped in JS)
            prisma.sale.findMany({ where: { createdAt: { gte: startOf7DaysAgo } }, select: { createdAt: true, totalAmount: true } }),
            prisma.purchase.findMany({ where: { date: { gte: startOf7DaysAgo } }, select: { date: true, totalAmount: true } }),
            prisma.expense.findMany({ where: { date: { gte: startOf7DaysAgo } }, select: { date: true, amount: true } }),
            // 12-month chart
            prisma.sale.findMany({ where: { createdAt: { gte: startOf12MAgo } }, select: { createdAt: true, totalAmount: true } }),
            prisma.purchase.findMany({ where: { date: { gte: startOf12MAgo } }, select: { date: true, totalAmount: true } }),
            prisma.expense.findMany({ where: { date: { gte: startOf12MAgo } }, select: { date: true, amount: true } }),
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
            // Sale items for COGS (month & today)
            prisma.saleItem.findMany({ where: { sale: { createdAt: { gte: startOfThisMonth } } }, select: { quantity: true, avgCostPrice: true, discount: true } }),
            prisma.saleItem.findMany({ where: { sale: { createdAt: { gte: startOfToday } } }, select: { quantity: true, avgCostPrice: true, discount: true } }),
            // All active products for inventory stats
            prisma.product.findMany({
                where: { active: true },
                select: { totalStock: true, reorderLevel: true, avgCostPrice: true, variants: { select: { price: true }, take: 1, orderBy: { id: "asc" } } },
            }),
        ]);

        // ── Inventory stats (computed in JS to support per-product reorderLevel)
        const lowStockCount = allActiveProducts.filter(p => p.totalStock > 0 && p.totalStock <= p.reorderLevel).length;
        const outOfStockCount = allActiveProducts.filter(p => p.totalStock <= 0).length;
        const totalProducts = allActiveProducts.length;
        const totalInventoryValue = allActiveProducts.reduce(
            (s, p) => s + p.totalStock * safeAvgCost(p.avgCostPrice, p.variants[0]?.price ?? 0),
            0
        );

        // ── COGS
        const todayCOGS = todaySaleItems.reduce((s, item) => s + item.quantity * item.avgCostPrice, 0);
        const monthCOGS = monthSaleItems.reduce((s, item) => s + item.quantity * item.avgCostPrice, 0);

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
        for (const s of salesLast7Days) {
            const e = dailyMap.get(dayjs(s.createdAt).format("YYYY-MM-DD"));
            if (e) {
                e.sales += s.totalAmount;
                if (s.totalAmount >= 0) {
                    e.salesCount++;
                }
            }
        }
        for (const p of purchasesLast7Days) {
            const e = dailyMap.get(dayjs(p.date).format("YYYY-MM-DD"));
            if (e) e.purchases += p.totalAmount;
        }
        for (const ex of expensesLast7Days) {
            const e = dailyMap.get(dayjs(ex.date).format("YYYY-MM-DD"));
            if (e) e.expenses += ex.amount;
        }
        const dailyChart = Array.from(dailyMap.entries()).map(([date, v]) => ({ date, ...v }));

        // ── 12-month chart — group by YYYY-MM
        const monthlyMap = new Map<string, { sales: number; salesCount: number; purchases: number; expenses: number }>();
        for (let i = 11; i >= 0; i--) {
            monthlyMap.set(now.subtract(i, "month").format("YYYY-MM"), { sales: 0, salesCount: 0, purchases: 0, expenses: 0 });
        }
        for (const s of salesLast12M) {
            const e = monthlyMap.get(dayjs(s.createdAt).format("YYYY-MM"));
            if (e) {
                e.sales += s.totalAmount;
                if (s.totalAmount >= 0) {
                    e.salesCount++;
                }
            }
        }
        for (const p of purchasesLast12M) {
            const e = monthlyMap.get(dayjs(p.date).format("YYYY-MM"));
            if (e) e.purchases += p.totalAmount;
        }
        for (const ex of expensesLast12M) {
            const e = monthlyMap.get(dayjs(ex.date).format("YYYY-MM"));
            if (e) e.expenses += ex.amount;
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
        const monthItemDiscounts = monthSaleItems.reduce((s, item) => s + (item.discount || 0) * item.quantity, 0);
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
