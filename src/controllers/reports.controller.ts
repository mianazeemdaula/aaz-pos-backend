import { Request, Response } from "express";
import dayjs from "dayjs";
import path from "path";
import QRCode from "qrcode";
import { prisma } from "../prisma/prisma";
import { createPDFGenerator, getReportFontTheme } from "../utils/pdf";
import { generateSignatureSection } from "../utils/pdf/pdfkit-components";

// ─── Shared helpers ──────────────────────────────────────────────────────────

const logoPath = path.join(__dirname, "../../logo/logo.jpg");

function fonts() {
    return getReportFontTheme();
}

function fmtCurrency(v: any) {
    return v != null ? Number(v).toLocaleString() : "0";
}

function fmtDate(v: any, fmt = "DD MMM YYYY") {
    return v ? dayjs(v).format(fmt) : "N/A";
}

/**
 * Returns a trustworthy avg cost price.
 * If avgCostPrice is corrupted (negative, non-finite, or > 1 billion — caused by
 * the weighted-average formula compounding on negative stock), falls back to 95%
 * of the variant sale price.
 */
function safeAvgCost(avgCostPrice: number, variantPrice: number): number {
    if (avgCostPrice > 0 && Number.isFinite(avgCostPrice) && avgCostPrice < 1e9) {
        return avgCostPrice;
    }
    const fallback = variantPrice * 0.95;
    return fallback > 0 ? fallback : 0;
}

function pdfConfig(
    title: string,
    subtitle: string,
    filterInfo: Record<string, string | number>,
    orientation: "portrait" | "landscape" = "portrait",
    size: "A4" | "A5" | "A3" = "A4",
    qrCodeBuffer?: Buffer
) {
    const reportFonts = fonts();
    return {
        fontRegistrations: reportFonts.registrations,
        fontFamilyMap: reportFonts.aliasMap,
        pdfOptions: {
            size: size as any,
            orientation,
            margins: { top: 10, bottom: 10, left: 20, right: 20 },
        },
        header: {
            title,
            subtitle,
            logo: { path: logoPath, width: 55, height: 55 },
            showDate: true,
            titleFont: { family: "Helvetica-Bold" as const, size: 14, color: "#1e40af" },
            subtitleFont: { size: 9, color: "#475569" },
            filterInfo,
            qrCode: qrCodeBuffer,
            qrCodeSize: 55,
        },
        footer: {
            leftText: "POS System",
            centerText: title,
            showPageNumber: true,
            font: { size: 8, color: "#666666" },
        },
    };
}

async function generateQRBuffer(text: string): Promise<Buffer | undefined> {
    try {
        return await QRCode.toBuffer(text, { width: 150, margin: 1, color: { dark: "#1e293b", light: "#ffffff" } });
    } catch {
        return undefined;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS (JSON) — enhanced
// ═══════════════════════════════════════════════════════════════════════════════

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
            salesToday, salesYesterday,
            salesThisMonth, purchasesThisMonth, expensesThisMonth,
            salesLastMonth, purchasesLastMonth, expensesLastMonth,
            pendingReturns, totalCustomers, totalSuppliers, newCustomersThisMonth,
            salesLast7Days, purchasesLast7Days, expensesLast7Days,
            salesLast12M, purchasesLast12M, expensesLast12M,
            topVariantsRaw, topCustomersRaw,
            recentSales,
            monthSaleItems, todaySaleItems,
            allActiveProducts,
        ] = await Promise.all([
            // Today / Yesterday
            prisma.sale.aggregate({ where: { createdAt: { gte: startOfToday } }, _sum: { totalAmount: true, paidAmount: true }, _count: true }),
            prisma.sale.aggregate({ where: { createdAt: { gte: startOfYesterday, lte: endOfYesterday } }, _sum: { totalAmount: true }, _count: true }),
            // This month
            prisma.sale.aggregate({ where: { createdAt: { gte: startOfThisMonth } }, _sum: { totalAmount: true, paidAmount: true, discount: true, taxAmount: true }, _count: true }),
            prisma.purchase.aggregate({ where: { date: { gte: startOfThisMonth } }, _sum: { totalAmount: true, paidAmount: true }, _count: true }),
            prisma.expense.aggregate({ where: { date: { gte: startOfThisMonth } }, _sum: { amount: true }, _count: true }),
            // Last month
            prisma.sale.aggregate({ where: { createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } }, _sum: { totalAmount: true }, _count: true }),
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
            prisma.saleItem.findMany({ where: { sale: { createdAt: { gte: startOfThisMonth } } }, select: { quantity: true, avgCostPrice: true } }),
            prisma.saleItem.findMany({ where: { sale: { createdAt: { gte: startOfToday } } }, select: { quantity: true, avgCostPrice: true } }),
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
            if (e) { e.sales += s.totalAmount; e.salesCount++; }
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
            if (e) { e.sales += s.totalAmount; e.salesCount++; }
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
        const todaySalesTotal = salesToday._sum.totalAmount ?? 0;
        const yesterdaySalesTotal = salesYesterday._sum.totalAmount ?? 0;
        const monthSalesTotal = salesThisMonth._sum.totalAmount ?? 0;
        const lastMonthSalesTotal = salesLastMonth._sum.totalAmount ?? 0;
        const monthPurchasesTotal = purchasesThisMonth._sum.totalAmount ?? 0;
        const lastMonthPurchasesTotal = purchasesLastMonth._sum.totalAmount ?? 0;
        const monthExpensesTotal = expensesThisMonth._sum.amount ?? 0;
        const lastMonthExpensesTotal = expensesLastMonth._sum.amount ?? 0;

        res.json({
            today: {
                salesTotal: todaySalesTotal,
                salesCount: salesToday._count,
                paidAmount: salesToday._sum.paidAmount ?? 0,
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
                paidAmount: salesThisMonth._sum.paidAmount ?? 0,
                discount: salesThisMonth._sum.discount ?? 0,
                taxAmount: salesThisMonth._sum.taxAmount ?? 0,
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


// ═══════════════════════════════════════════════════════════════════════════════
// 1. SALES REPORT — PDF
// ═══════════════════════════════════════════════════════════════════════════════

export const getSalesReportPDF = async (req: Request, res: Response): Promise<void> => {
    const { from, to } = req.query;
    const where: any = {};
    if (from) where.createdAt = { ...where.createdAt, gte: new Date(from as string) };
    if (to) {
        const toDate = new Date(to as string);
        toDate.setHours(23, 59, 59, 999);
        where.createdAt = { ...where.createdAt, lte: toDate };
    }

    try {
        const sales = await prisma.sale.findMany({
            where,
            orderBy: { createdAt: "desc" },
            include: {
                customer: { select: { name: true } },
                items: { select: { quantity: true, avgCostPrice: true, totalPrice: true } },
            },
        });

        const totalRevenue = sales.reduce((s, sale) => s + sale.totalAmount, 0);
        const totalDiscount = sales.reduce((s, sale) => s + sale.discount, 0);
        const totalTax = sales.reduce((s, sale) => s + sale.taxAmount, 0);
        const totalCOGS = sales.reduce((s, sale) =>
            s + sale.items.reduce((is, item) => is + item.avgCostPrice * item.quantity, 0), 0);
        const grossProfit = totalRevenue - totalCOGS;
        const totalPaid = sales.reduce((s, sale) => s + sale.paidAmount, 0);
        const totalDue = sales.reduce((s, sale) => s + (sale.totalAmount - sale.paidAmount), 0);

        const rows = sales.map((sale, i) => ({
            sno: i + 1,
            date: sale.createdAt,
            customer: sale.customer?.name ?? "Walk-in",
            itemsCount: sale.items.length,
            discount: sale.discount,
            tax: sale.taxAmount,
            total: sale.totalAmount,
            paid: sale.paidAmount,
            due: sale.totalAmount - sale.paidAmount,
        }));

        const salesQr = await generateQRBuffer(`Sales Report | ${from ? fmtDate(from as string) : "All"} - ${to ? fmtDate(to as string) : "Now"} | Txns: ${sales.length}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Sales Report", "Sales Transaction Summary", {
                "From": from ? fmtDate(from as string) : "All Time",
                "To": to ? fmtDate(to as string) : "Now",
                "Transactions": sales.length,
            }, "landscape", "A4", salesQr)
        );
        const doc = pdfGen.getDocument();

        // Summary section
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Revenue", align: { x: "left", y: "center" } },
            { text: "Total Discount", align: { x: "left", y: "center" } },
            { text: "Total Tax", align: { x: "left", y: "center" } },
            { text: "Cost of Goods", align: { x: "left", y: "center" } },
            { text: "Gross Profit", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: fmtCurrency(totalRevenue), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDiscount), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalTax), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCOGS), align: { x: "left", y: "center" } },
            { text: fmtCurrency(grossProfit), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();

        pdfGen.moveDown(0.5);

        // Main transactions table — 9 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, 80, "*", 50, 75, 75, 80, 80, 80],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Customer", align: { x: "left", y: "center" } },
            { text: "Items", align: { x: "center", y: "center" } },
            { text: "Discount", align: { x: "right", y: "center" } },
            { text: "Tax", align: { x: "right", y: "center" } },
            { text: "Total", align: { x: "right", y: "center" } },
            { text: "Paid", align: { x: "right", y: "center" } },
            { text: "Due", align: { x: "right", y: "center" } },
        ]);
        rows.forEach((row) => {
            table.row([
                { text: String(row.sno), align: { x: "center", y: "center" } },
                { text: fmtDate(row.date, "DD-MM-YYYY hh:mm A"), align: { x: "center", y: "center" } },
                { text: row.customer, align: { x: "left", y: "center" } },
                { text: String(row.itemsCount), align: { x: "center", y: "center" } },
                { text: fmtCurrency(row.discount), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.tax), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.total), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.paid), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.due), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Grand Total", colSpan: 4, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDiscount), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalTax), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalRevenue), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalPaid), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalDue), align: { x: "right", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `sales-report-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Sales report PDF error:", error);
        res.status(500).json({ error: "Failed to generate sales report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. PURCHASES REPORT — PDF
// ═══════════════════════════════════════════════════════════════════════════════

export const getPurchasesReportPDF = async (req: Request, res: Response): Promise<void> => {
    const { from, to } = req.query;
    const where: any = {};
    if (from) where.date = { ...where.date, gte: new Date(from as string) };
    if (to) where.date = { ...where.date, lte: new Date(to as string) };

    try {
        const purchases = await prisma.purchase.findMany({
            where,
            orderBy: { date: "desc" },
            include: {
                supplier: { select: { name: true } },
                items: { select: { quantity: true, totalCost: true } },
            },
        });

        const totalCost = purchases.reduce((s, p) => s + p.totalAmount, 0);
        const totalPaid = purchases.reduce((s, p) => s + p.paidAmount, 0);
        const totalDue = totalCost - totalPaid;
        const totalDiscount = purchases.reduce((s, p) => s + p.discount, 0);
        const totalTax = purchases.reduce((s, p) => s + p.taxAmount, 0);

        const rows = purchases.map((p, i) => ({
            sno: i + 1,
            date: p.date,
            supplier: p.supplier?.name ?? "N/A",
            invoiceNo: p.invoiceNo ?? "N/A",
            itemsCount: p.items.length,
            discount: p.discount,
            tax: p.taxAmount,
            total: p.totalAmount,
            paid: p.paidAmount,
            due: p.totalAmount - p.paidAmount,
        }));

        const purchQr = await generateQRBuffer(`Purchases Report | ${from ? fmtDate(from as string) : "All"} - ${to ? fmtDate(to as string) : "Now"} | Orders: ${purchases.length}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Purchases Report", "Purchase Order Summary", {
                "From": from ? fmtDate(from as string) : "All Time",
                "To": to ? fmtDate(to as string) : "Now",
                "Total Orders": purchases.length,
            }, "landscape", "A4", purchQr)
        );
        const doc = pdfGen.getDocument();

        // Summary
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Cost", align: { x: "left", y: "center" } },
            { text: "Total Discount", align: { x: "left", y: "center" } },
            { text: "Total Tax", align: { x: "left", y: "center" } },
            { text: "Total Due", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: fmtCurrency(totalCost), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDiscount), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalTax), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDue), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();

        pdfGen.moveDown(0.5);

        // Purchases table — 10 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, 80, "*", 80, 50, 70, 70, 80, 80, 80],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Supplier", align: { x: "left", y: "center" } },
            { text: "Invoice No.", align: { x: "center", y: "center" } },
            { text: "Items", align: { x: "center", y: "center" } },
            { text: "Discount", align: { x: "right", y: "center" } },
            { text: "Tax", align: { x: "right", y: "center" } },
            { text: "Total", align: { x: "right", y: "center" } },
            { text: "Paid", align: { x: "right", y: "center" } },
            { text: "Due", align: { x: "right", y: "center" } },
        ]);
        rows.forEach((row) => {
            table.row([
                { text: String(row.sno), align: { x: "center", y: "center" } },
                { text: fmtDate(row.date, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: row.supplier, align: { x: "left", y: "center" } },
                { text: row.invoiceNo, align: { x: "center", y: "center" } },
                { text: String(row.itemsCount), align: { x: "center", y: "center" } },
                { text: fmtCurrency(row.discount), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.tax), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.total), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.paid), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.due), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Grand Total", colSpan: 5, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDiscount), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalTax), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalCost), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalPaid), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalDue), align: { x: "right", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `purchases-report-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Purchases report PDF error:", error);
        res.status(500).json({ error: "Failed to generate purchases report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. INVENTORY REPORT — PDF
// ═══════════════════════════════════════════════════════════════════════════════

export const getInventoryReportPDF = async (req: Request, res: Response): Promise<void> => {
    try {
        // Set a longer timeout for large inventories
        req.setTimeout(120_000);

        const products = await prisma.product.findMany({
            where: { active: true },
            select: {
                id: true,
                name: true,
                totalStock: true,
                reorderLevel: true,
                avgCostPrice: true,
                category: { select: { name: true } },
                brand: { select: { name: true } },
                variants: { select: { price: true }, take: 1 },
            },
            orderBy: { name: "asc" },
        });

        const lowStock = products.filter((p) => p.totalStock > 0 && p.totalStock <= p.reorderLevel);
        const outOfStock = products.filter((p) => p.totalStock <= 0);
        const totalValue = products.reduce((s, p) => s + p.totalStock * safeAvgCost(p.avgCostPrice, p.variants[0]?.price ?? 0), 0);

        const rows = products.map((p, i) => ({
            sno: i + 1,
            name: p.name,
            category: p.category.name,
            brand: p.brand?.name ?? "N/A",
            totalStock: p.totalStock,
            reorderLevel: p.reorderLevel,
            avgCost: safeAvgCost(p.avgCostPrice, p.variants[0]?.price ?? 0),
            stockValue: p.totalStock * safeAvgCost(p.avgCostPrice, p.variants[0]?.price ?? 0),
            status: p.totalStock <= 0 ? "Out of Stock" : p.totalStock <= p.reorderLevel ? "Low Stock" : "OK",
        }));

        const qr = await generateQRBuffer(`Inventory Report | ${dayjs().format("DD-MM-YYYY")} | Products: ${products.length} | Value: ${fmtCurrency(totalValue)}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Inventory Report", "Product Stock Overview", {
                "Total Products": products.length,
                "Low Stock": lowStock.length,
                "Out of Stock": outOfStock.length,
                "Total Value": fmtCurrency(totalValue),
            }, "landscape", "A4", qr)
        );
        const doc = pdfGen.getDocument();

        // Summary
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Products", align: { x: "left", y: "center" } },
            { text: "Low Stock Items", align: { x: "left", y: "center" } },
            { text: "Out of Stock", align: { x: "left", y: "center" } },
            { text: "Total Inventory Value", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: products.length.toString(), align: { x: "left", y: "center" } },
            { text: lowStock.length.toString(), align: { x: "left", y: "center" } },
            { text: outOfStock.length.toString(), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalValue), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();

        pdfGen.moveDown(0.5);

        // Products table — 9 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, "*", 90, 80, 65, 70, 75, 90, 70],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Product", align: { x: "left", y: "center" } },
            { text: "Category", align: { x: "left", y: "center" } },
            { text: "Brand", align: { x: "left", y: "center" } },
            { text: "Total Stock", align: { x: "right", y: "center" } },
            { text: "Reorder Lvl", align: { x: "right", y: "center" } },
            { text: "Avg Cost", align: { x: "right", y: "center" } },
            { text: "Stock Value", align: { x: "right", y: "center" } },
            { text: "Status", align: { x: "center", y: "center" } },
        ]);
        rows.forEach((row) => {
            table.row([
                { text: String(row.sno), align: { x: "center", y: "center" } },
                { text: row.name, align: { x: "left", y: "center" } },
                { text: row.category, align: { x: "left", y: "center" } },
                { text: row.brand, align: { x: "left", y: "center" } },
                { text: fmtCurrency(row.totalStock), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.reorderLevel), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.avgCost), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.stockValue), align: { x: "right", y: "center" } },
                { text: row.status, align: { x: "center", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Grand Total", colSpan: 4, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(products.reduce((s, p) => s + p.totalStock, 0)), align: { x: "right", y: "center" } },
            { text: "", align: { x: "center", y: "center" } },
            { text: "", align: { x: "center", y: "center" } },
            { text: fmtCurrency(totalValue), align: { x: "right", y: "center" } },
            { text: "", align: { x: "center", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `inventory-report-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Inventory report PDF error:", error);
        res.status(500).json({ error: "Failed to generate inventory report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 4. EXPENSES REPORT — PDF
// ═══════════════════════════════════════════════════════════════════════════════

export const getExpensesReportPDF = async (req: Request, res: Response): Promise<void> => {
    const { from, to } = req.query;
    const where: any = {};
    if (from) where.date = { ...where.date, gte: new Date(from as string) };
    if (to) where.date = { ...where.date, lte: new Date(to as string) };

    try {
        const expenses = await prisma.expense.findMany({
            where,
            orderBy: { date: "desc" },
            include: { account: { select: { name: true } } },
        });

        const totalAmount = expenses.reduce((s, e) => s + e.amount, 0);
        const byCategory: Record<string, number> = {};
        for (const e of expenses) {
            byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
        }

        const rows = expenses.map((e, i) => ({
            sno: i + 1,
            date: e.date,
            description: e.description,
            category: e.category,
            account: e.account.name,
            amount: e.amount,
        }));

        const expQr = await generateQRBuffer(`Expenses Report | ${from ? fmtDate(from as string) : "All"} - ${to ? fmtDate(to as string) : "Now"} | Records: ${expenses.length}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Expenses Report", "Expense Transactions", {
                "From": from ? fmtDate(from as string) : "All Time",
                "To": to ? fmtDate(to as string) : "Now",
                "Total Records": expenses.length,
            }, undefined, undefined, expQr)
        );
        const doc = pdfGen.getDocument();

        // Category breakdown summary
        const catEntries = [["Total Expenses", fmtCurrency(totalAmount)], ...Object.entries(byCategory).map(([c, v]) => [c, fmtCurrency(v)])];
        const catCols = Math.min(catEntries.length, 4);
        const catColStyles: ("*" | number)[] = Array(catCols).fill("*");
        doc.x = doc.page.margins.left;
        const catTable = doc.table({ columnStyles: catColStyles });
        for (let i = 0; i < catEntries.length; i += catCols) {
            const chunk = catEntries.slice(i, i + catCols);
            while (chunk.length < catCols) chunk.push(["", ""]);
            catTable.row(chunk.map(([label]) => ({ text: label, align: { x: "left" as const, y: "center" as const } })));
            catTable.row(chunk.map(([, value]) => ({ text: value, align: { x: "left" as const, y: "center" as const } })));
        }
        catTable.end();

        pdfGen.moveDown(0.5);

        // Expenses table — 6 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, 80, "*", 90, 90, 90],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Description", align: { x: "left", y: "center" } },
            { text: "Category", align: { x: "left", y: "center" } },
            { text: "Account", align: { x: "left", y: "center" } },
            { text: "Amount", align: { x: "right", y: "center" } },
        ]);
        rows.forEach((row) => {
            table.row([
                { text: String(row.sno), align: { x: "center", y: "center" } },
                { text: fmtDate(row.date, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: row.description, align: { x: "left", y: "center" } },
                { text: row.category, align: { x: "left", y: "center" } },
                { text: row.account, align: { x: "left", y: "center" } },
                { text: fmtCurrency(row.amount), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Grand Total", colSpan: 5, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalAmount), align: { x: "right", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `expenses-report-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Expenses report PDF error:", error);
        res.status(500).json({ error: "Failed to generate expenses report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 5. CUSTOMER BALANCES (RECEIVABLES) REPORT — PDF
// ═══════════════════════════════════════════════════════════════════════════════

export const getCustomerBalancesReportPDF = async (req: Request, res: Response): Promise<void> => {
    try {
        const customers = await prisma.customer.findMany({
            where: { active: true, balance: { not: 0 } },
            orderBy: { balance: "desc" },
        });

        const totalReceivable = customers.filter((c) => c.balance > 0).reduce((s, c) => s + c.balance, 0);
        const totalOverpaid = customers.filter((c) => c.balance < 0).reduce((s, c) => s + Math.abs(c.balance), 0);

        const rows = customers.map((c, i) => ({
            sno: i + 1,
            name: c.name,
            phone: c.phone ?? "N/A",
            address: c.address ?? "N/A",
            creditLimit: c.creditLimit ?? 0,
            balance: c.balance,
            status: c.balance > 0 ? "Receivable" : "Overpaid",
        }));

        const custQr = await generateQRBuffer(`Customer Balances | Customers: ${customers.length} | Receivable: ${fmtCurrency(totalReceivable)}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Customer Balances Report", "Accounts Receivable", {
                "Total Customers": customers.length,
                "Total Receivable": fmtCurrency(totalReceivable),
                "Total Overpaid": fmtCurrency(totalOverpaid),
            }, undefined, undefined, custQr)
        );
        const doc = pdfGen.getDocument();

        // Summary
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Customers", align: { x: "left", y: "center" } },
            { text: "Total Receivable", align: { x: "left", y: "center" } },
            { text: "Total Overpaid", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: customers.length.toString(), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalReceivable), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalOverpaid), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();

        pdfGen.moveDown(0.5);

        // Customer balances table — 7 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, "*", 85, 110, 85, 90, 75],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Customer Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "center", y: "center" } },
            { text: "Address", align: { x: "left", y: "center" } },
            { text: "Credit Limit", align: { x: "right", y: "center" } },
            { text: "Balance", align: { x: "right", y: "center" } },
            { text: "Status", align: { x: "center", y: "center" } },
        ]);
        rows.forEach((row) => {
            table.row([
                { text: String(row.sno), align: { x: "center", y: "center" } },
                { text: row.name, align: { x: "left", y: "center" } },
                { text: row.phone, align: { x: "center", y: "center" } },
                { text: row.address, align: { x: "left", y: "center" } },
                { text: row.creditLimit > 0 ? fmtCurrency(row.creditLimit) : "No Limit", align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.balance), align: { x: "right", y: "center" } },
                { text: row.status, align: { x: "center", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Grand Total", colSpan: 5, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalReceivable - totalOverpaid), align: { x: "right", y: "center" } },
            { text: "", align: { x: "center", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `customer-balances-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Customer balances PDF error:", error);
        res.status(500).json({ error: "Failed to generate customer balances report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 6. SUPPLIER BALANCES (PAYABLES) REPORT — PDF
// ═══════════════════════════════════════════════════════════════════════════════

export const getSupplierBalancesReportPDF = async (req: Request, res: Response): Promise<void> => {
    try {
        const suppliers = await prisma.supplier.findMany({
            where: { active: true, balance: { not: 0 } },
            orderBy: { balance: "desc" },
        });

        const totalPayable = suppliers.filter((s) => s.balance > 0).reduce((s, sup) => s + sup.balance, 0);
        const totalOverpaid = suppliers.filter((s) => s.balance < 0).reduce((s, sup) => s + Math.abs(sup.balance), 0);

        const rows = suppliers.map((s, i) => ({
            sno: i + 1,
            name: s.name,
            phone: s.phone ?? "N/A",
            paymentTerms: s.paymentTerms ?? "N/A",
            taxId: s.taxId ?? "N/A",
            balance: s.balance,
            status: s.balance > 0 ? "Payable" : "Overpaid",
        }));

        const suppQr = await generateQRBuffer(`Supplier Balances | Suppliers: ${suppliers.length} | Payable: ${fmtCurrency(totalPayable)}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Supplier Balances Report", "Accounts Payable", {
                "Total Suppliers": suppliers.length,
                "Total Payable": fmtCurrency(totalPayable),
                "Total Overpaid": fmtCurrency(totalOverpaid),
            }, undefined, undefined, suppQr)
        );
        const doc = pdfGen.getDocument();

        // Summary
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Suppliers", align: { x: "left", y: "center" } },
            { text: "Total Payable", align: { x: "left", y: "center" } },
            { text: "Total Overpaid", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: suppliers.length.toString(), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalPayable), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalOverpaid), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();

        pdfGen.moveDown(0.5);

        // Supplier balances table — 7 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, "*", 85, 100, 90, 90, 70],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Supplier Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "center", y: "center" } },
            { text: "Payment Terms", align: { x: "left", y: "center" } },
            { text: "Tax ID", align: { x: "center", y: "center" } },
            { text: "Balance", align: { x: "right", y: "center" } },
            { text: "Status", align: { x: "center", y: "center" } },
        ]);
        rows.forEach((row) => {
            table.row([
                { text: String(row.sno), align: { x: "center", y: "center" } },
                { text: row.name, align: { x: "left", y: "center" } },
                { text: row.phone, align: { x: "center", y: "center" } },
                { text: row.paymentTerms, align: { x: "left", y: "center" } },
                { text: row.taxId, align: { x: "center", y: "center" } },
                { text: fmtCurrency(row.balance), align: { x: "right", y: "center" } },
                { text: row.status, align: { x: "center", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Grand Total", colSpan: 5, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalPayable - totalOverpaid), align: { x: "right", y: "center" } },
            { text: "", align: { x: "center", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `supplier-balances-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Supplier balances PDF error:", error);
        res.status(500).json({ error: "Failed to generate supplier balances report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 7. CUSTOMER ACCOUNT STATEMENT — PDF
// ═══════════════════════════════════════════════════════════════════════════════

export const getCustomerStatementPDF = async (req: Request, res: Response): Promise<void> => {
    const customerId = Number(req.params.customerId);
    const { from, to } = req.query;

    try {
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) { res.status(404).json({ message: "Customer not found" }); return; }

        const ledgerWhere: any = { customerId };
        if (from) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, gte: new Date(from as string) };
        if (to) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, lte: new Date(to as string) };

        const ledgerEntries = await prisma.customerLedger.findMany({
            where: ledgerWhere,
            orderBy: { createdAt: "asc" },
        });

        // Determine debit/credit direction by type
        const debitTypes = ["SALE", "ADJUSTMENT_DR"];
        let runningBalance = 0;
        const ledgerRows = ledgerEntries.map((entry) => {
            const isDebit = debitTypes.includes(entry.type);
            const debit = isDebit ? entry.amount : 0;
            const credit = !isDebit ? entry.amount : 0;
            runningBalance = entry.balance;
            return { ...entry, debit, credit, runningBalance: entry.balance };
        });

        const totalDebit = ledgerRows.reduce((s, r) => s + r.debit, 0);
        const totalCredit = ledgerRows.reduce((s, r) => s + r.credit, 0);
        const closingBalance = ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].runningBalance : customer.balance;

        // Total sales and payments in period
        const salesCount = ledgerEntries.filter((e) => e.type === "SALE").length;
        const paymentsCount = ledgerEntries.filter((e) => e.type === "PAYMENT").length;

        const reportFonts = fonts();
        const pdfGen = createPDFGenerator({
            fontRegistrations: reportFonts.registrations,
            fontFamilyMap: reportFonts.aliasMap,
            pdfOptions: {
                size: "A4",
                margins: { top: 10, bottom: 10, left: 20, right: 20 },
            },
            header: {
                title: "Customer Account Statement",
                subtitle: `Customer: ${customer.name}`,
                logo: { path: logoPath, width: 60, height: 60 },
                showDate: true,
                titleFont: { size: 16 },
                subtitleFont: { size: 10, color: "#666666" },
                filterInfo: {
                    "From": from ? fmtDate(from as string) : "All",
                    "To": to ? fmtDate(to as string) : "Now",
                },
            },
            footer: {
                leftText: "POS System",
                centerText: "Customer Statement",
                showPageNumber: true,
                font: { size: 8, color: "#666666" },
            },
        });

        const doc = pdfGen.getDocument();

        // Customer info
        doc.x = doc.page.margins.left;
        const infoTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        infoTable.row([
            { text: "Customer Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "left", y: "center" } },
            { text: "Address", align: { x: "left", y: "center" } },
            { text: "Credit Limit", align: { x: "left", y: "center" } },
        ]);
        infoTable.row([
            { text: customer.name, align: { x: "left", y: "center" } },
            { text: customer.phone ?? "N/A", align: { x: "left", y: "center" } },
            { text: customer.address ?? "N/A", align: { x: "left", y: "center" } },
            { text: customer.creditLimit != null ? fmtCurrency(customer.creditLimit) : "No Limit", align: { x: "left", y: "center" } },
        ]);
        infoTable.end();

        pdfGen.moveDown(0.4);

        // Account summary
        doc.x = doc.page.margins.left;
        const acctTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        acctTable.row([
            { text: "Total Invoiced", align: { x: "left", y: "center" } },
            { text: "Total Paid", align: { x: "left", y: "center" } },
            { text: "Closing Balance", align: { x: "left", y: "center" } },
            { text: "Transactions", align: { x: "left", y: "center" } },
        ]);
        acctTable.row([
            { text: fmtCurrency(totalDebit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "left", y: "center" } },
            { text: `${salesCount} sales, ${paymentsCount} payments`, align: { x: "left", y: "center" } },
        ]);
        acctTable.end();

        pdfGen.moveDown(0.5);

        // Ledger table — 6 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [80, 90, "*", 80, 80, 85],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Type", align: { x: "center", y: "center" } },
            { text: "Reference / Note", align: { x: "left", y: "center" } },
            { text: "Debit", align: { x: "right", y: "center" } },
            { text: "Credit", align: { x: "right", y: "center" } },
            { text: "Balance", align: { x: "right", y: "center" } },
        ]);
        ledgerRows.forEach((row) => {
            table.row([
                { text: fmtDate(row.createdAt, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: row.type.replace(/_/g, " "), align: { x: "center", y: "center" } },
                { text: row.reference ?? row.note ?? "-", align: { x: "left", y: "center" } },
                { text: row.debit ? fmtCurrency(row.debit) : "-", align: { x: "right", y: "center" } },
                { text: row.credit ? fmtCurrency(row.credit) : "-", align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.runningBalance), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Total", colSpan: 3, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "right", y: "center" } },
        ]);
        table.end();

        pdfGen.moveDown(1);

        generateSignatureSection(doc, {
            signatures: [
                { label: "Customer Signature", name: "_________________", title: customer.name },
                { label: "Accountant", name: "_________________", title: "Accounts Dept." },
                { label: "Manager", name: "_________________", title: "General Manager" },
            ],
            spacing: 30,
            lineWidth: 120,
            labelFont: { family: "Helvetica-Bold", size: 8 },
            nameFont: { size: 9 },
        });

        await pdfGen.sendToResponse(res, `customer-statement-${customer.name}-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Customer statement PDF error:", error);
        res.status(500).json({ error: "Failed to generate customer statement PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 8. SUPPLIER ACCOUNT STATEMENT — PDF
// ═══════════════════════════════════════════════════════════════════════════════

export const getSupplierStatementPDF = async (req: Request, res: Response): Promise<void> => {
    const supplierId = Number(req.params.supplierId);
    const { from, to } = req.query;

    try {
        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) { res.status(404).json({ message: "Supplier not found" }); return; }

        const ledgerWhere: any = { supplierId };
        if (from) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, gte: new Date(from as string) };
        if (to) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, lte: new Date(to as string) };

        const ledgerEntries = await prisma.supplierLedger.findMany({
            where: ledgerWhere,
            orderBy: { createdAt: "asc" },
        });

        // Debit types increase what we owe; credit types decrease it
        const debitTypes = ["PURCHASE", "ADJUSTMENT_DR"];
        const ledgerRows = ledgerEntries.map((entry) => {
            const isDebit = debitTypes.includes(entry.type);
            const debit = isDebit ? entry.amount : 0;
            const credit = !isDebit ? entry.amount : 0;
            return { ...entry, debit, credit, runningBalance: entry.balance };
        });

        const totalDebit = ledgerRows.reduce((s, r) => s + r.debit, 0);
        const totalCredit = ledgerRows.reduce((s, r) => s + r.credit, 0);
        const closingBalance = ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].runningBalance : supplier.balance;

        const purchasesCount = ledgerEntries.filter((e) => e.type === "PURCHASE").length;
        const paymentsCount = ledgerEntries.filter((e) => e.type === "PAYMENT").length;

        const reportFonts = fonts();
        const pdfGen = createPDFGenerator({
            fontRegistrations: reportFonts.registrations,
            fontFamilyMap: reportFonts.aliasMap,
            pdfOptions: {
                size: "A4",
                margins: { top: 10, bottom: 10, left: 20, right: 20 },
            },
            header: {
                title: "Supplier Account Statement",
                subtitle: `Supplier: ${supplier.name}`,
                logo: { path: logoPath, width: 60, height: 60 },
                showDate: true,
                titleFont: { family: "Helvetica-Bold" as const, size: 16 },
                subtitleFont: { size: 10, color: "#666666" },
                filterInfo: {
                    "From": from ? fmtDate(from as string) : "All",
                    "To": to ? fmtDate(to as string) : "Now",
                },
            },
            footer: {
                leftText: "POS System",
                centerText: "Supplier Statement",
                showPageNumber: true,
                font: { size: 8, color: "#666666" },
            },
        });

        const doc = pdfGen.getDocument();

        // Supplier info
        doc.x = doc.page.margins.left;
        const infoTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        infoTable.row([
            { text: "Supplier Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "left", y: "center" } },
            { text: "Payment Terms", align: { x: "left", y: "center" } },
            { text: "Tax ID", align: { x: "left", y: "center" } },
        ]);
        infoTable.row([
            { text: supplier.name, align: { x: "left", y: "center" } },
            { text: supplier.phone ?? "N/A", align: { x: "left", y: "center" } },
            { text: supplier.paymentTerms ?? "N/A", align: { x: "left", y: "center" } },
            { text: supplier.taxId ?? "N/A", align: { x: "left", y: "center" } },
        ]);
        infoTable.end();

        pdfGen.moveDown(0.4);

        // Account summary
        doc.x = doc.page.margins.left;
        const acctTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        acctTable.row([
            { text: "Total Purchases", align: { x: "left", y: "center" } },
            { text: "Total Paid", align: { x: "left", y: "center" } },
            { text: "Closing Balance", align: { x: "left", y: "center" } },
            { text: "Transactions", align: { x: "left", y: "center" } },
        ]);
        acctTable.row([
            { text: fmtCurrency(totalDebit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "left", y: "center" } },
            { text: `${purchasesCount} purchases, ${paymentsCount} payments`, align: { x: "left", y: "center" } },
        ]);
        acctTable.end();

        pdfGen.moveDown(0.5);

        // Ledger table — 6 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [80, 90, "*", 80, 80, 85],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Type", align: { x: "center", y: "center" } },
            { text: "Reference / Note", align: { x: "left", y: "center" } },
            { text: "Debit", align: { x: "right", y: "center" } },
            { text: "Credit", align: { x: "right", y: "center" } },
            { text: "Balance", align: { x: "right", y: "center" } },
        ]);
        ledgerRows.forEach((row) => {
            table.row([
                { text: fmtDate(row.createdAt, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: row.type.replace(/_/g, " "), align: { x: "center", y: "center" } },
                { text: row.reference ?? row.note ?? "-", align: { x: "left", y: "center" } },
                { text: row.debit ? fmtCurrency(row.debit) : "-", align: { x: "right", y: "center" } },
                { text: row.credit ? fmtCurrency(row.credit) : "-", align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.runningBalance), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Total", colSpan: 3, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "right", y: "center" } },
        ]);
        table.end();

        pdfGen.moveDown(1);

        generateSignatureSection(doc, {
            signatures: [
                { label: "Supplier Signature", name: "_________________", title: supplier.name },
                { label: "Accountant", name: "_________________", title: "Accounts Dept." },
                { label: "Manager", name: "_________________", title: "General Manager" },
            ],
            spacing: 30,
            lineWidth: 120,
            labelFont: { family: "Helvetica-Bold", size: 8 },
            nameFont: { size: 9 },
        });

        await pdfGen.sendToResponse(res, `supplier-statement-${supplier.name}-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Supplier statement PDF error:", error);
        res.status(500).json({ error: "Failed to generate supplier statement PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 9. CUSTOMER LEDGER REPORT — selected customer — PDF
// ═══════════════════════════════════════════════════════════════════════════════

export const getCustomerLedgerReportPDF = async (req: Request, res: Response): Promise<void> => {
    const customerId = Number(req.params.customerId);
    const { from, to } = req.query;

    try {
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) { res.status(404).json({ message: "Customer not found" }); return; }

        const ledgerWhere: any = { customerId };
        if (from) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, gte: new Date(from as string) };
        if (to) {
            const toDate = new Date(to as string);
            toDate.setHours(23, 59, 59, 999);
            ledgerWhere.createdAt = { ...ledgerWhere.createdAt, lte: toDate };
        }

        const entries = await prisma.customerLedger.findMany({
            where: ledgerWhere,
            orderBy: { createdAt: "asc" },
        });

        // Calculate opening balance: balance of the last entry BEFORE the date range
        let openingBalance = 0;
        if (from) {
            const lastBefore = await prisma.customerLedger.findFirst({
                where: { customerId, createdAt: { lt: new Date(from as string) } },
                orderBy: { createdAt: "desc" },
            });
            openingBalance = lastBefore ? lastBefore.balance : 0;
        }

        const debitTypes = ["SALE", "ADJUSTMENT_DR"];

        let totalDebit = 0;
        let totalCredit = 0;
        const ledgerRows = entries.map((entry) => {
            const debit = entry.debit || (debitTypes.includes(entry.type) ? entry.amount : 0);
            const credit = entry.credit || (!debitTypes.includes(entry.type) ? entry.amount : 0);
            totalDebit += debit;
            totalCredit += credit;
            return { ...entry, debit, credit };
        });
        const closingBalance = ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].balance : (from ? openingBalance : customer.balance);

        const reportFonts = fonts();
        const pdfGen = createPDFGenerator({
            fontRegistrations: reportFonts.registrations,
            fontFamilyMap: reportFonts.aliasMap,
            pdfOptions: { size: "A4", margins: { top: 10, bottom: 10, left: 20, right: 20 } },
            header: {
                title: "Customer Ledger Report",
                subtitle: `Customer: ${customer.name}`,
                logo: { path: logoPath, width: 60, height: 60 },
                showDate: true,
                titleFont: { size: 16 },
                subtitleFont: { size: 10, color: "#666666" },
                filterInfo: {
                    "From": from ? fmtDate(from as string) : "All",
                    "To": to ? fmtDate(to as string) : "Now",
                },
            },
            footer: {
                leftText: "POS System",
                centerText: "Customer Ledger",
                showPageNumber: true,
                font: { size: 8, color: "#666666" },
            },
        });
        const doc = pdfGen.getDocument();

        // Customer info
        doc.x = doc.page.margins.left;
        const infoTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        infoTable.row([
            { text: "Customer Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "left", y: "center" } },
            { text: "Address", align: { x: "left", y: "center" } },
            { text: "Credit Limit", align: { x: "left", y: "center" } },
        ]);
        infoTable.row([
            { text: customer.name, align: { x: "left", y: "center" } },
            { text: customer.phone ?? "N/A", align: { x: "left", y: "center" } },
            { text: customer.address ?? "N/A", align: { x: "left", y: "center" } },
            { text: customer.creditLimit != null ? fmtCurrency(customer.creditLimit) : "No Limit", align: { x: "left", y: "center" } },
        ]);
        infoTable.end();

        pdfGen.moveDown(0.4);

        // Account summary
        doc.x = doc.page.margins.left;
        const acctTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        acctTable.row([
            { text: "Opening Balance", align: { x: "left", y: "center" } },
            { text: "Total Debit", align: { x: "left", y: "center" } },
            { text: "Total Credit", align: { x: "left", y: "center" } },
            { text: "Closing Balance", align: { x: "left", y: "center" } },
        ]);
        acctTable.row([
            { text: fmtCurrency(openingBalance), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "left", y: "center" } },
        ]);
        acctTable.end();

        pdfGen.moveDown(0.5);

        // Ledger table
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [80, 90, "*", 80, 80, 85],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Type", align: { x: "center", y: "center" } },
            { text: "Reference / Note", align: { x: "left", y: "center" } },
            { text: "Debit", align: { x: "right", y: "center" } },
            { text: "Credit", align: { x: "right", y: "center" } },
            { text: "Balance", align: { x: "right", y: "center" } },
        ]);
        // Opening balance row
        if (from) {
            table.row([
                { text: fmtDate(from as string, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: "OPENING BAL", align: { x: "center", y: "center" } },
                { text: "Opening Balance", align: { x: "left", y: "center" } },
                { text: "-", align: { x: "right", y: "center" } },
                { text: "-", align: { x: "right", y: "center" } },
                { text: fmtCurrency(openingBalance), align: { x: "right", y: "center" } },
            ]);
        }
        ledgerRows.forEach((row) => {
            table.row([
                { text: fmtDate(row.createdAt, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: row.type.replace(/_/g, " "), align: { x: "center", y: "center" } },
                { text: row.reference ?? row.note ?? "-", align: { x: "left", y: "center" } },
                { text: row.debit ? fmtCurrency(row.debit) : "-", align: { x: "right", y: "center" } },
                { text: row.credit ? fmtCurrency(row.credit) : "-", align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.balance), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Total", colSpan: 3, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "right", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `customer-ledger-${customer.name}-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Customer ledger report PDF error:", error);
        res.status(500).json({ error: "Failed to generate customer ledger report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 10. SUPPLIER LEDGER REPORT — selected supplier — PDF
// ═══════════════════════════════════════════════════════════════════════════════

export const getSupplierLedgerReportPDF = async (req: Request, res: Response): Promise<void> => {
    const supplierId = Number(req.params.supplierId);
    const { from, to } = req.query;

    try {
        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) { res.status(404).json({ message: "Supplier not found" }); return; }

        const ledgerWhere: any = { supplierId };
        if (from) ledgerWhere.createdAt = { ...ledgerWhere.createdAt, gte: new Date(from as string) };
        if (to) {
            const toDate = new Date(to as string);
            toDate.setHours(23, 59, 59, 999);
            ledgerWhere.createdAt = { ...ledgerWhere.createdAt, lte: toDate };
        }

        const entries = await prisma.supplierLedger.findMany({
            where: ledgerWhere,
            orderBy: { createdAt: "asc" },
        });

        // Calculate opening balance: balance of the last entry BEFORE the date range
        let openingBalance = 0;
        if (from) {
            const lastBefore = await prisma.supplierLedger.findFirst({
                where: { supplierId, createdAt: { lt: new Date(from as string) } },
                orderBy: { createdAt: "desc" },
            });
            openingBalance = lastBefore ? lastBefore.balance : 0;
        }

        const debitTypes = ["PURCHASE", "ADJUSTMENT_DR"];

        let totalDebit = 0;
        let totalCredit = 0;
        const ledgerRows = entries.map((entry) => {
            const debit = entry.debit || (debitTypes.includes(entry.type) ? entry.amount : 0);
            const credit = entry.credit || (!debitTypes.includes(entry.type) ? entry.amount : 0);
            totalDebit += debit;
            totalCredit += credit;
            return { ...entry, debit, credit };
        });
        const closingBalance = ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].balance : (from ? openingBalance : supplier.balance);

        const reportFonts = fonts();
        const pdfGen = createPDFGenerator({
            fontRegistrations: reportFonts.registrations,
            fontFamilyMap: reportFonts.aliasMap,
            pdfOptions: { size: "A4", margins: { top: 10, bottom: 10, left: 20, right: 20 } },
            header: {
                title: "Supplier Ledger Report",
                subtitle: `Supplier: ${supplier.name}`,
                logo: { path: logoPath, width: 60, height: 60 },
                showDate: true,
                titleFont: { family: "Helvetica-Bold" as const, size: 16 },
                subtitleFont: { size: 10, color: "#666666" },
                filterInfo: {
                    "From": from ? fmtDate(from as string) : "All",
                    "To": to ? fmtDate(to as string) : "Now",
                },
            },
            footer: {
                leftText: "POS System",
                centerText: "Supplier Ledger",
                showPageNumber: true,
                font: { size: 8, color: "#666666" },
            },
        });
        const doc = pdfGen.getDocument();

        // Supplier info
        doc.x = doc.page.margins.left;
        const infoTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        infoTable.row([
            { text: "Supplier Name", align: { x: "left", y: "center" } },
            { text: "Phone", align: { x: "left", y: "center" } },
            { text: "Payment Terms", align: { x: "left", y: "center" } },
            { text: "Tax ID", align: { x: "left", y: "center" } },
        ]);
        infoTable.row([
            { text: supplier.name, align: { x: "left", y: "center" } },
            { text: supplier.phone ?? "N/A", align: { x: "left", y: "center" } },
            { text: supplier.paymentTerms ?? "N/A", align: { x: "left", y: "center" } },
            { text: supplier.taxId ?? "N/A", align: { x: "left", y: "center" } },
        ]);
        infoTable.end();

        pdfGen.moveDown(0.4);

        // Account summary
        doc.x = doc.page.margins.left;
        const acctTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        acctTable.row([
            { text: "Opening Balance", align: { x: "left", y: "center" } },
            { text: "Total Debit", align: { x: "left", y: "center" } },
            { text: "Total Credit", align: { x: "left", y: "center" } },
            { text: "Closing Balance", align: { x: "left", y: "center" } },
        ]);
        acctTable.row([
            { text: fmtCurrency(openingBalance), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "left", y: "center" } },
        ]);
        acctTable.end();

        pdfGen.moveDown(0.5);

        // Ledger table
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [80, 90, "*", 80, 80, 85],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Type", align: { x: "center", y: "center" } },
            { text: "Reference / Note", align: { x: "left", y: "center" } },
            { text: "Debit", align: { x: "right", y: "center" } },
            { text: "Credit", align: { x: "right", y: "center" } },
            { text: "Balance", align: { x: "right", y: "center" } },
        ]);
        // Opening balance row
        if (from) {
            table.row([
                { text: fmtDate(from as string, "DD-MM-YYYY"), align: { x: "center", y: "center" } },
                { text: "OPENING BAL", align: { x: "center", y: "center" } },
                { text: "Opening Balance", align: { x: "left", y: "center" } },
                { text: "-", align: { x: "right", y: "center" } },
                { text: "-", align: { x: "right", y: "center" } },
                { text: fmtCurrency(openingBalance), align: { x: "right", y: "center" } },
            ]);
        }
        ledgerRows.forEach((row) => {
            table.row([
                { text: fmtDate(row.createdAt, "DD-MM-YYYY hh:mm:A"), align: { x: "center", y: "center" } },
                { text: row.type.replace(/_/g, " "), align: { x: "center", y: "center" } },
                { text: row.reference ?? row.note ?? "-", align: { x: "left", y: "center" } },
                { text: row.debit ? fmtCurrency(row.debit) : "-", align: { x: "right", y: "center" } },
                { text: row.credit ? fmtCurrency(row.credit) : "-", align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.balance), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Total", colSpan: 3, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(closingBalance), align: { x: "right", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `supplier-ledger-${supplier.name}-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Supplier ledger report PDF error:", error);
        res.status(500).json({ error: "Failed to generate supplier ledger report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 11. ACCOUNT STATEMENT — PDF
//     Shows all transactions that touched a given Account (chart-of-accounts)
//     across every source: sales, purchases, expenses, supplier & customer
//     payments, salary slips, employee advances, sale returns, purchase returns.
// ═══════════════════════════════════════════════════════════════════════════════

export const getAccountStatementPDF = async (req: Request, res: Response): Promise<void> => {
    const accountId = Number(req.params.accountId);
    const { from, to } = req.query;

    if (isNaN(accountId)) { res.status(400).json({ error: "Invalid account id" }); return; }

    const dateFrom = from ? new Date(from as string) : undefined;
    const dateTo = (() => {
        if (!to) return undefined;
        const d = new Date(to as string);
        d.setHours(23, 59, 59, 999);
        return d;
    })();

    try {
        const account = await prisma.account.findUnique({ where: { id: accountId } });
        if (!account) { res.status(404).json({ error: "Account not found" }); return; }

        // Helper to build a date-range where clause for different field names
        const tsRange = (field: "createdAt" | "date" = "createdAt") => {
            const where: any = {};
            if (dateFrom) where[field] = { ...where[field], gte: dateFrom };
            if (dateTo) where[field] = { ...where[field], lte: dateTo };
            return where;
        };
        const tsRangeRaw = (field: string) => {
            const where: any = {};
            if (dateFrom) where[field] = { ...where[field], gte: dateFrom };
            if (dateTo) where[field] = { ...where[field], lte: dateTo };
            return where;
        };

        // Fetch all transaction types that reference this account
        const [
            salePayments,
            customerPayments,
            supplierPayments,
            purchases,
            expenses,
            salarySlips,
            employeeAdvances,
        ] = await Promise.all([
            prisma.salePayment.findMany({
                where: { accountId, ...tsRange("createdAt") },
                orderBy: { createdAt: "asc" },
                select: {
                    id: true, saleId: true, amount: true, note: true, createdAt: true,
                    sale: { select: { id: true, customer: { select: { name: true } } } }
                },
            }),
            prisma.customerPayment.findMany({
                where: { accountId, ...tsRange("date") },
                orderBy: { date: "asc" },
                select: {
                    id: true, amount: true, note: true, date: true,
                    customer: { select: { name: true } }
                },
            }),
            prisma.supplierPayment.findMany({
                where: { accountId, ...tsRange("date") },
                orderBy: { date: "asc" },
                select: {
                    id: true, amount: true, note: true, date: true,
                    supplier: { select: { name: true } }
                },
            }),
            prisma.purchase.findMany({
                where: { accountId, ...tsRange("date") },
                orderBy: { date: "asc" },
                select: {
                    id: true, invoiceNo: true, totalAmount: true, paidAmount: true, note: true, date: true,
                    supplier: { select: { name: true } }
                },
            }),
            prisma.expense.findMany({
                where: { accountId, ...tsRange("date") },
                orderBy: { date: "asc" },
                select: { id: true, description: true, category: true, amount: true, date: true },
            }),
            prisma.salarySlip.findMany({
                where: { accountId, status: "PAID", ...tsRangeRaw("paidDate") },
                orderBy: { paidDate: "asc" },
                select: {
                    id: true, year: true, month: true, netPayable: true, paidDate: true,
                    employee: { select: { name: true } }
                },
            }),
            prisma.employeeAdvance.findMany({
                where: { accountId, ...tsRange("date") },
                orderBy: { date: "asc" },
                select: {
                    id: true, amount: true, reason: true, date: true,
                    employee: { select: { name: true } }
                },
            }),
        ]);

        // ── Build a unified entry list with sign (CASH IN = +, CASH OUT = -)
        type TxEntry = { date: Date; type: string; reference: string; description: string; debit: number; credit: number };
        const entries: TxEntry[] = [];

        for (const sp of salePayments) {
            entries.push({
                date: sp.createdAt,
                type: "Sale Payment",
                reference: `INV-${sp.saleId}`,
                description: sp.sale.customer?.name ?? "Walk-in",
                debit: sp.amount,  // money in
                credit: 0,
            });
        }
        for (const cp of customerPayments) {
            entries.push({
                date: cp.date,
                type: "Customer Payment",
                reference: `CUST-PMT-${cp.id}`,
                description: cp.customer.name + (cp.note ? ` — ${cp.note}` : ""),
                debit: cp.amount,
                credit: 0,
            });
        }
        for (const sp of supplierPayments) {
            entries.push({
                date: sp.date,
                type: "Supplier Payment",
                reference: `SUPP-PMT-${sp.id}`,
                description: sp.supplier.name + (sp.note ? ` — ${sp.note}` : ""),
                debit: 0,
                credit: sp.amount,  // money out
            });
        }
        for (const p of purchases) {
            entries.push({
                date: p.date,
                type: "Purchase",
                reference: p.invoiceNo ?? `PO-${p.id}`,
                description: p.supplier?.name ?? "N/A",
                debit: 0,
                credit: p.paidAmount,  // money out
            });
        }
        for (const ex of expenses) {
            entries.push({
                date: ex.date,
                type: `Expense (${ex.category})`,
                reference: `EXP-${ex.id}`,
                description: ex.description,
                debit: 0,
                credit: ex.amount,  // money out
            });
        }
        for (const sl of salarySlips) {
            const empName = sl.employee.name;
            entries.push({
                date: sl.paidDate ?? new Date(sl.year, sl.month - 1),
                type: "Salary",
                reference: `SAL-${sl.year}-${String(sl.month).padStart(2, "0")}`,
                description: empName,
                debit: 0,
                credit: sl.netPayable,  // money out
            });
        }
        for (const ea of employeeAdvances) {
            entries.push({
                date: ea.date,
                type: "Employee Advance",
                reference: `ADV-${ea.id}`,
                description: ea.employee.name + (ea.reason ? ` — ${ea.reason}` : ""),
                debit: 0,
                credit: ea.amount,  // money out
            });
        }
        // Sort chronologically
        entries.sort((a, b) => a.date.getTime() - b.date.getTime());

        const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
        const totalCredit = entries.reduce((s, e) => s + e.credit, 0);
        const netBalance = totalDebit - totalCredit;

        // PDF
        const reportFonts = fonts();
        const pdfGen = createPDFGenerator({
            fontRegistrations: reportFonts.registrations,
            fontFamilyMap: reportFonts.aliasMap,
            pdfOptions: {
                size: "A4",
                orientation: "landscape",
                margins: { top: 10, bottom: 10, left: 20, right: 20 },
            },
            header: {
                title: "Account Statement",
                subtitle: `${account.code} — ${account.name} (${account.type})`,
                logo: { path: logoPath, width: 60, height: 60 },
                showDate: true,
                titleFont: { family: "Helvetica-Bold" as const, size: 16 },
                subtitleFont: { size: 10, color: "#666666" },
                filterInfo: {
                    "Account": `${account.code} / ${account.name}`,
                    "Type": account.type,
                    "From": from ? fmtDate(from as string) : "All Time",
                    "To": to ? fmtDate(to as string) : "Now",
                    "Entries": entries.length,
                },
            },
            footer: {
                leftText: "POS System",
                centerText: "Account Statement",
                showPageNumber: true,
                font: { size: 8, color: "#666666" },
            },
        });

        const doc = pdfGen.getDocument();

        // Summary bar
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Debit (IN)", align: { x: "left", y: "center" } },
            { text: "Total Credit (OUT)", align: { x: "left", y: "center" } },
            { text: "Net Balance", align: { x: "left", y: "center" } },
            { text: "Transactions", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: fmtCurrency(totalDebit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "left", y: "center" } },
            { text: fmtCurrency(netBalance), align: { x: "left", y: "center" } },
            { text: entries.length.toString(), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();
        pdfGen.moveDown(0.5);

        // Ledger table — 7 columns
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, 80, 110, "*", 110, 90, 90],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Type", align: { x: "left", y: "center" } },
            { text: "Description / Reference", align: { x: "left", y: "center" } },
            { text: "Reference", align: { x: "center", y: "center" } },
            { text: "Debit (IN)", align: { x: "right", y: "center" } },
            { text: "Credit (OUT)", align: { x: "right", y: "center" } },
        ]);
        entries.forEach((entry, i) => {
            table.row([
                { text: String(i + 1), align: { x: "center", y: "center" } },
                { text: fmtDate(entry.date, "DD-MM-YYYY hh:mm A"), align: { x: "center", y: "center" } },
                { text: entry.type, align: { x: "left", y: "center" } },
                { text: entry.description, align: { x: "left", y: "center" } },
                { text: entry.reference, align: { x: "center", y: "center" } },
                { text: entry.debit ? fmtCurrency(entry.debit) : "-", align: { x: "right", y: "center" } },
                { text: entry.credit ? fmtCurrency(entry.credit) : "-", align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(9);
        table.row([
            { text: "Grand Total", colSpan: 5, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDebit), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalCredit), align: { x: "right", y: "center" } },
        ]);
        table.end();

        pdfGen.moveDown(1);
        generateSignatureSection(doc, {
            signatures: [
                { label: "Prepared By", name: "_________________", title: "Accountant" },
                { label: "Reviewed By", name: "_________________", title: "Finance Manager" },
                { label: "Approved By", name: "_________________", title: "General Manager" },
            ],
            spacing: 30,
            lineWidth: 120,
            labelFont: { family: "Helvetica-Bold", size: 8 },
            nameFont: { size: 9 },
        });

        const safeName = account.name.replace(/[^a-zA-Z0-9_-]/g, "_");
        await pdfGen.sendToResponse(res, `account-statement-${safeName}-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Account statement PDF error:", error);
        res.status(500).json({ error: "Failed to generate account statement PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// STOCK REPORT — negative + low-stock products PDF
// ═══════════════════════════════════════════════════════════════════════════════
export const getStockReportPDF = async (req: Request, res: Response): Promise<void> => {
    const filter = (req.query.filter as string) ?? "all"; // all | negative | low
    try {
        const products = await prisma.product.findMany({
            where: { active: true, isService: false },
            orderBy: { name: "asc" },
            include: {
                category: { select: { name: true } },
                brand: { select: { name: true } },
                variants: { select: { name: true, barcode: true, price: true, isDefault: true }, orderBy: { isDefault: "desc" } },
            },
        });

        const negative = products.filter(p => p.totalStock < 0);
        const lowStock = products.filter(p => p.totalStock >= 0 && p.totalStock <= p.reorderLevel);
        const normal = products.filter(p => p.totalStock > p.reorderLevel);

        let rows = products;
        let title = "Full Stock Report";
        if (filter === "negative") { rows = negative; title = "Negative Stock Report"; }
        else if (filter === "low") { rows = lowStock; title = "Low Stock Report"; }
        else if (filter === "alert") { rows = [...negative, ...lowStock]; title = "Stock Alert Report"; }

        const stockQr = await generateQRBuffer(`${title} | Products: ${rows.length} | Negative: ${negative.length} | Low: ${lowStock.length}`);
        const pdfGen = createPDFGenerator(pdfConfig(
            title,
            "Inventory Stock Levels",
            {
                "Total Products": rows.length,
                "Negative Stock": negative.length,
                "Low Stock": lowStock.length,
                "Normal Stock": normal.length,
                "Generated": fmtDate(new Date()),
            },
            "landscape",
            undefined,
            stockQr
        ));
        const doc = pdfGen.getDocument();

        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: ["auto", "*", "*", 60, 60, 70, 80, 80],
            rowStyles: (row: number) => {
                if (row === 0) return { backgroundColor: "#1e293b", textColor: "#ffffff", fontSize: 9, fontStyle: "bold" };
                const p = rows[row - 1];
                if (!p) return {};
                if (p.totalStock < 0) return { backgroundColor: "#fee2e2" };
                if (p.totalStock <= p.reorderLevel) return { backgroundColor: "#fef9c3" };
                return {};
            },
        });

        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Product Name", align: { x: "left", y: "center" } },
            { text: "Category", align: { x: "left", y: "center" } },
            { text: "Barcode", align: { x: "center", y: "center" } },
            { text: "Stock", align: { x: "center", y: "center" } },
            { text: "Reorder Lvl", align: { x: "center", y: "center" } },
            { text: "Avg Cost", align: { x: "right", y: "center" } },
            { text: "Status", align: { x: "center", y: "center" } },
        ]);

        rows.forEach((p, i) => {
            const defaultVariant = p.variants.find(v => v.isDefault) ?? p.variants[0];
            const status = p.totalStock < 0 ? "⚠ NEGATIVE" : p.totalStock <= p.reorderLevel ? "⚡ LOW" : "✓ OK";
            table.row([
                { text: String(i + 1), align: { x: "center", y: "center" } },
                { text: p.name, align: { x: "left", y: "center" } },
                { text: p.category.name, align: { x: "left", y: "center" } },
                { text: defaultVariant?.barcode ?? "—", align: { x: "center", y: "center" } },
                { text: String(p.totalStock), align: { x: "center", y: "center" } },
                { text: String(p.reorderLevel), align: { x: "center", y: "center" } },
                { text: fmtCurrency(safeAvgCost(p.avgCostPrice, defaultVariant?.price ?? 0)), align: { x: "right", y: "center" } },
                { text: status, align: { x: "center", y: "center" } },
            ]);
        });
        table.end();

        await pdfGen.sendToResponse(res, `stock-report-${filter}-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Stock report PDF error:", error);
        res.status(500).json({ error: "Failed to generate stock report PDF" });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY REPORT — comprehensive: sales, purchases, expenses, recurring, salaries,
//               P&L, accounts, discounts for a given date
// ═══════════════════════════════════════════════════════════════════════════════
export const getDailyReportPDF = async (req: Request, res: Response): Promise<void> => {
    const dateStr = (req.query.date as string) ?? dayjs().format("YYYY-MM-DD");
    const startOfDay = dayjs(dateStr).startOf("day").toDate();
    const endOfDay = dayjs(dateStr).endOf("day").toDate();

    try {
        const [
            sales,
            purchases,
            expenses,
            recurringExpenses,
            salarySlips,
            customerPayments,
            supplierPayments,
        ] = await Promise.all([
            prisma.sale.findMany({
                where: { createdAt: { gte: startOfDay, lte: endOfDay } },
                include: {
                    customer: { select: { name: true } },
                    items: { select: { quantity: true, avgCostPrice: true, totalPrice: true, discount: true } },
                    payments: { include: { account: { select: { name: true } } } },
                },
                orderBy: { createdAt: "asc" },
            }),
            prisma.purchase.findMany({
                where: { date: { gte: startOfDay, lte: endOfDay } },
                include: {
                    supplier: { select: { name: true } },
                    items: { select: { quantity: true, unitCost: true, totalCost: true } },
                    payments: { include: { account: { select: { name: true } } } },
                },
                orderBy: { date: "asc" },
            }),
            prisma.expense.findMany({
                where: { date: { gte: startOfDay, lte: endOfDay } },
                include: { account: { select: { name: true } } },
                orderBy: { date: "asc" },
            }),
            prisma.recurringExpense.findMany({ where: { active: true } }),
            prisma.salarySlip.findMany({
                where: { paidDate: { gte: startOfDay, lte: endOfDay } },
                include: { employee: { select: { name: true } } },
                orderBy: { paidDate: "asc" },
            }),
            prisma.customerPayment.findMany({
                where: { date: { gte: startOfDay, lte: endOfDay } },
                include: { customer: { select: { name: true } }, account: { select: { name: true } } },
                orderBy: { date: "asc" },
            }),
            prisma.supplierPayment.findMany({
                where: { date: { gte: startOfDay, lte: endOfDay } },
                include: { supplier: { select: { name: true } }, account: { select: { name: true } } },
                orderBy: { date: "asc" },
            }),
        ]);

        // ── Aggregates ──
        const totalRevenue = sales.reduce((s, x) => s + x.totalAmount, 0);
        const totalDiscount = sales.reduce((s, x) => s + x.discount, 0);
        const totalTax = sales.reduce((s, x) => s + x.taxAmount, 0);
        const totalCOGS = sales.reduce((s, x) =>
            s + x.items.reduce((is, item) => is + item.avgCostPrice * item.quantity, 0), 0);
        const totalSalesPaid = sales.reduce((s, x) => s + x.paidAmount, 0);
        // const totalSalesDue = totalRevenue - totalSalesPaid;
        const grossProfit = totalRevenue - totalCOGS;

        const totalPurchases = purchases.reduce((s, x) => s + x.totalAmount, 0);
        const totalPurchasesPaid = purchases.reduce((s, x) => s + x.paidAmount, 0);

        const totalExpenses = expenses.reduce((s, x) => s + x.amount, 0);
        const totalSalaries = salarySlips.reduce((s, x) => s + x.netPayable, 0);
        const totalCustPayments = customerPayments.reduce((s, x) => s + x.amount, 0);
        const totalSuppPayments = supplierPayments.reduce((s, x) => s + x.amount, 0);
        const dailyRecurringExpenses = recurringExpenses.reduce((s, x) => s + (x.frequency == 'MONTHLY' ? x.amount / 30 : x.amount), 0);
        const netProfit = grossProfit - totalExpenses - totalSalaries;

        const dailyQr = await generateQRBuffer(`Daily Report | ${fmtDate(dateStr)} | Sales: ${sales.length} | Purchases: ${purchases.length}`);
        const pdfGen = createPDFGenerator(pdfConfig(
            "Daily Report",
            `Summary for ${fmtDate(dateStr)}`,
            {
                "Date": fmtDate(dateStr),
                "Sales": sales.length,
                "Purchases": purchases.length,
                "Expenses": expenses.length,
            },
            "portrait",
            undefined,
            dailyQr
        ));
        const doc = pdfGen.getDocument();

        const sectionHeader = (title: string, color = "#1e293b") => {
            doc.x = doc.page.margins.left;
            doc.fontSize(11).fillColor(color).text(title);
            doc.moveDown(0.3);
        };

        // ── P&L Summary Table ──
        sectionHeader("Daily P&L Summary", "#1e40af");
        doc.x = doc.page.margins.left;
        doc.fontSize(8);
        const summaryTable = doc.table({
            columnStyles: ["*", "*"],
            rowStyles: (row: number) => {
                if (row === 0) return { backgroundColor: "#dbeafe", fontSize: 10, fontStyle: "bold" };
                if (row % 2 === 0) return { backgroundColor: "#f8fafc" };
                return {};
            },
        });
        [
            ["Metric", "Amount (Rs)"],
            [`Sales Revenue (${sales.length} invoices)`, fmtCurrency(totalRevenue)],
            [`  Discount Given`, fmtCurrency(totalDiscount)],
            [`  Tax Collected`, fmtCurrency(totalTax)],
            [`  COGS`, fmtCurrency(totalCOGS)],
            [`  Gross Profit`, fmtCurrency(grossProfit)],
            [`Purchases (${purchases.length} orders)`, fmtCurrency(totalPurchases)],
            [`Expenses (${expenses.length})`, fmtCurrency(totalExpenses)],
            [`Recurring Expenses (Daily)`, fmtCurrency(dailyRecurringExpenses)],
            [`Salaries Paid (${salarySlips.length})`, fmtCurrency(totalSalaries)],
            [`Customer Payments Received`, fmtCurrency(totalCustPayments)],
            [`Supplier Payments Made`, fmtCurrency(totalSuppPayments)],
            [`Net Profit`, fmtCurrency(netProfit)],
        ].forEach((row, i) => {
            summaryTable.row([
                { text: row[0], align: { x: "left", y: "center" } },
                { text: i === 0 ? row[1] : row[1], align: { x: "right", y: "center" } },
            ]);
        });
        summaryTable.end();
        pdfGen.moveDown(0.8);

        // ── Sales table ──
        // if (sales.length > 0) {
        //     sectionHeader(`Sales (${sales.length})`, "#166534");
        //     doc.x = doc.page.margins.left;
        //     const t = doc.table({
        //         columnStyles: [30, 70, "*", 70, 70, 70, 60],
        //         rowStyles: (row: number) => row === 0 ? { backgroundColor: "#dcfce7", fontStyle: "bold", fontSize: 9 } : {},
        //     });
        //     t.row(["#", "Time", "Customer", "Discount", "Tax", "Total", "Paid"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
        //     sales.forEach((s, i) => {
        //         t.row([
        //             { text: String(i + 1), align: { x: "center", y: "center" } },
        //             { text: fmtDate(s.createdAt, "hh:mm A"), align: { x: "center", y: "center" } },
        //             { text: s.customer?.name ?? "Walk-in", align: { x: "left", y: "center" } },
        //             { text: fmtCurrency(s.discount), align: { x: "right", y: "center" } },
        //             { text: fmtCurrency(s.taxAmount), align: { x: "right", y: "center" } },
        //             { text: fmtCurrency(s.totalAmount), align: { x: "right", y: "center" } },
        //             { text: fmtCurrency(s.paidAmount), align: { x: "right", y: "center" } },
        //         ]);
        //     });
        //     t.row([
        //         { text: "Total", colSpan: 3, align: { x: "right", y: "center" } },
        //         { text: fmtCurrency(totalDiscount), align: { x: "right", y: "center" } },
        //         { text: fmtCurrency(totalTax), align: { x: "right", y: "center" } },
        //         { text: fmtCurrency(totalRevenue), align: { x: "right", y: "center" } },
        //         { text: fmtCurrency(totalSalesPaid), align: { x: "right", y: "center" } },
        //     ]);
        //     t.end();
        //     pdfGen.moveDown(0.8);
        // }

        // ── Purchases table ──
        if (purchases.length > 0) {
            sectionHeader(`Purchases (${purchases.length})`, "#1e3a8a");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 70, "*", 80, 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#dbeafe", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Supplier", "Total", "Paid"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            purchases.forEach((p, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(p.date, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: p.supplier?.name ?? "N/A", align: { x: "left", y: "center" } },
                    { text: fmtCurrency(p.totalAmount), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(p.paidAmount), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 3, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalPurchases), align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalPurchasesPaid), align: { x: "right", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.8);
        }

        // ── Expenses table ──
        if (expenses.length > 0) {
            sectionHeader(`Expenses (${expenses.length})`, "#7c2d12");
            doc.fontSize(8);
            doc.x = doc.page.margins.left;
            const t = doc.table({
                columnStyles: [30, 70, "*", "*", 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#fee2e2", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Description", "Category", "Amount"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            expenses.forEach((ex, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(ex.date, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: ex.description, align: { x: "left", y: "center" } },
                    { text: ex.category, align: { x: "left", y: "center" } },
                    { text: fmtCurrency(ex.amount), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 4, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalExpenses), align: { x: "right", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.8);
        }

        // ── Salaries table ──
        if (salarySlips.length > 0) {
            sectionHeader(`Salaries Paid (${salarySlips.length})`, "#5b21b6");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, "*", 70, 70, 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ede9fe", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Employee", "Month/Year", "Advances", "Net Paid"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            salarySlips.forEach((sl, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: sl.employee.name, align: { x: "left", y: "center" } },
                    { text: `${sl.month}/${sl.year}`, align: { x: "center", y: "center" } },
                    { text: fmtCurrency(sl.totalAdvances), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(sl.netPayable), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 4, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalSalaries), align: { x: "right", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.8);
        }

        // ── Customer payments ──
        if (customerPayments.length > 0) {
            sectionHeader(`Customer Payments Received (${customerPayments.length})`, "#0f766e");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 70, "*", "*", 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ccfbf1", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Customer", "Account", "Amount"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            customerPayments.forEach((cp, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(cp.date, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: cp.customer.name, align: { x: "left", y: "center" } },
                    { text: cp.account.name, align: { x: "left", y: "center" } },
                    { text: fmtCurrency(cp.amount), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 4, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalCustPayments), align: { x: "right", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.8);
        }

        // ── Supplier payments ──
        if (supplierPayments.length > 0) {
            sectionHeader(`Supplier Payments Made (${supplierPayments.length})`, "#9a3412");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 70, "*", "*", 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ffedd5", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Time", "Supplier", "Account", "Amount"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            supplierPayments.forEach((sp, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(sp.date, "hh:mm A"), align: { x: "center", y: "center" } },
                    { text: sp.supplier.name, align: { x: "left", y: "center" } },
                    { text: sp.account.name, align: { x: "left", y: "center" } },
                    { text: fmtCurrency(sp.amount), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 4, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalSuppPayments), align: { x: "right", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.8);
        }

        // ── Recurring Expenses note ──
        if (recurringExpenses.length > 0) {
            sectionHeader(`Active Recurring Expenses (${recurringExpenses.length})`, "#92400e");
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: ["*", "*", "*", 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#fef3c7", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["Name", "Category", "Frequency", "Amount (Rs)"].map(h => ({ text: h, align: { x: "left", y: "center" } })));
            recurringExpenses.forEach(re => {
                t.row([
                    { text: re.name, align: { x: "left", y: "center" } },
                    { text: re.category, align: { x: "left", y: "center" } },
                    { text: re.frequency, align: { x: "left", y: "center" } },
                    { text: fmtCurrency(re.amount), align: { x: "right", y: "center" } },
                ]);
            });
            t.end();
            pdfGen.moveDown(0.8);
        }

        generateSignatureSection(doc, {
            signatures: [
                { label: "Prepared By", name: "_________________", title: "Cashier" },
                { label: "Reviewed By", name: "_________________", title: "Manager" },
                { label: "Approved By", name: "_________________", title: "Owner" },
            ],
            spacing: 30,
            lineWidth: 120,
            labelFont: { family: "Helvetica-Bold", size: 8 },
            nameFont: { size: 9 },
        });

        await pdfGen.sendToResponse(res, `daily-report-${dateStr}.pdf`);
    } catch (error) {
        console.error("Daily report PDF error:", error);
        res.status(500).json({ error: "Failed to generate daily report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
