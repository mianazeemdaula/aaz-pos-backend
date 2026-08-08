import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import {
    fmtDate,
    fmtCurrency,
    createReport,
    reportFilename,
    sendReport,
    safeAvgCost,
} from "./helpers";
import type { TableCell } from "../../utils/pdf/report-spec";
import { computeSupplierBalance } from "../../utils/balance";

const SIGN_OFF = [
    { label: "Prepared By", name: "_________________", title: "Accountant" },
    { label: "Approved By", name: "_________________", title: "Manager" },
];

export const getPurchasesReportPDF = async (req: Request, res: Response): Promise<void> => {
    const { from, to } = req.query;
    const where: any = {};
    if (from) where.date = { ...where.date, gte: new Date(`${from}T00:00:00.000`) };
    if (to) where.date = { ...where.date, lte: new Date(`${to}T23:59:59.999`) };

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

        const report = createReport({
            title: "Purchases Report",
            subtitle: "Purchase order summary",
            filename: reportFilename("purchases-report"),
            orientation: "landscape",
            filters: {
                From: from ? fmtDate(from as string) : "All Time",
                To: to ? fmtDate(to as string) : "Now",
                Orders: purchases.length,
            },
        });

        report.stats([
            { label: "Total Purchases", value: fmtCurrency(totalCost), tone: "primary", note: `${purchases.length} orders` },
            { label: "Amount Paid", value: fmtCurrency(totalPaid), tone: "success" },
            { label: "Payable Due", value: fmtCurrency(totalDue), tone: totalDue > 0 ? "danger" : "muted" },
            { label: "Discounts Received", value: fmtCurrency(totalDiscount), tone: "warning" },
            { label: "Tax Paid", value: fmtCurrency(totalTax) },
        ]);

        report.section("Purchase Orders", `${purchases.length} record(s)`);

        if (purchases.length === 0) {
            report.note("No purchases were recorded for the selected period.");
        } else {
            const rows: TableCell[][] = purchases.map((p, i) => {
                const due = p.totalAmount - p.paidAmount;
                return [
                    String(i + 1),
                    fmtDate(p.date, "DD-MM-YYYY"),
                    p.supplier?.name ?? "N/A",
                    p.invoiceNo ?? "N/A",
                    String(p.items.length),
                    fmtCurrency(p.discount),
                    fmtCurrency(p.taxAmount),
                    fmtCurrency(p.totalAmount),
                    fmtCurrency(p.paidAmount),
                    { text: fmtCurrency(due), align: "right" as const, tone: due > 0 ? ("danger" as const) : undefined },
                ];
            });

            report.table({
                columns: [
                    { label: "#", width: 26, align: "center" },
                    { label: "Date", width: 76, align: "center" },
                    { label: "Supplier", width: "*" },
                    { label: "Invoice No.", width: 88, align: "center" },
                    { label: "Items", width: 44, align: "center" },
                    { label: "Discount", width: 70, align: "right" },
                    { label: "Tax", width: 64, align: "right" },
                    { label: "Total", width: 80, align: "right" },
                    { label: "Paid", width: 80, align: "right" },
                    { label: "Due", width: 78, align: "right" },
                ],
                rows,
                totalRow: [
                    { text: "Grand Total", colSpan: 5 },
                    fmtCurrency(totalDiscount),
                    fmtCurrency(totalTax),
                    fmtCurrency(totalCost),
                    fmtCurrency(totalPaid),
                    fmtCurrency(totalDue),
                ],
            });
        }

        await sendReport(res, report);
    } catch (error) {
        console.error("Purchases report PDF error:", error);
        res.status(500).json({ error: "Failed to generate purchases report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

export const getSupplierBusinessReportPDF = async (req: Request, res: Response): Promise<void> => {
    try {
        const supplierId = parseInt(req.params.supplierId);
        if (isNaN(supplierId)) { res.status(400).json({ error: "Invalid supplier ID" }); return; }

        const from = req.query.from ? dayjs(req.query.from as string).startOf("day").toDate() : dayjs().subtract(1, "month").startOf("month").toDate();
        const to = req.query.to ? dayjs(req.query.to as string).endOf("day").toDate() : dayjs().endOf("day").toDate();

        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

        const purchases = await prisma.purchase.findMany({
            where: { supplierId, date: { gte: from, lte: to } },
            include: { items: { include: { product: true } } },
            orderBy: { date: "desc" },
        });

        // Returns are stored as purchases with a negative total.
        const returns = purchases.filter(p => p.totalAmount < 0);
        const regularPurchases = purchases.filter(p => p.totalAmount >= 0);

        const payments = await prisma.supplierPayment.findMany({
            where: { supplierId, date: { gte: from, lte: to } },
            include: { account: true },
            orderBy: { date: "desc" },
        });

        const totalPurchases = regularPurchases.reduce((s, p) => s + p.totalAmount, 0);
        const totalPaid = regularPurchases.reduce((s, p) => s + p.paidAmount, 0);
        const totalReturns = returns.reduce((s, p) => s + p.totalAmount, 0);
        const totalPayments = payments.reduce((s, p) => s + p.amount, 0);
        const totalItems = regularPurchases.reduce((s, p) => s + (p.items?.length ?? 0), 0);
        const netBusiness = totalPurchases - totalReturns;
        const currentBalance = await computeSupplierBalance(supplierId);

        const report = createReport({
            title: "Supplier Business Report",
            subtitle: `${supplier.name} — ${fmtDate(from)} to ${fmtDate(to)}`,
            filename: `supplier-business-${supplier.name.replace(/\s+/g, "-")}-${dayjs(from).format("YYYY-MM-DD")}-${dayjs(to).format("YYYY-MM-DD")}.pdf`,
            filters: {
                Supplier: supplier.name,
                Phone: supplier.phone ?? "N/A",
                Period: `${fmtDate(from)} — ${fmtDate(to)}`,
            },
        });

        report.stats([
            { label: "Total Purchases", value: fmtCurrency(totalPurchases), tone: "primary", note: `${regularPurchases.length} orders` },
            { label: "Returns", value: fmtCurrency(totalReturns), tone: "warning" },
            { label: "Net Business", value: fmtCurrency(netBusiness), tone: "primary" },
            { label: "Paid on Purchases", value: fmtCurrency(totalPaid), tone: "success" },
            { label: "Standalone Payments", value: fmtCurrency(totalPayments), tone: "success" },
            {
                label: "Current Balance",
                value: fmtCurrency(currentBalance),
                tone: currentBalance > 0 ? "danger" : "muted",
                note: currentBalance > 0 ? "payable to supplier" : undefined,
            },
        ]);

        if (regularPurchases.length > 0) {
            report.section("Purchases", `${regularPurchases.length} order(s)`);
            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "PO #", width: 90, align: "center" },
                    { label: "Date", width: 84, align: "center" },
                    { label: "Total", width: "*", align: "right" },
                    { label: "Paid", width: 88, align: "right" },
                    { label: "Due", width: 88, align: "right" },
                    { label: "Items", width: 52, align: "center" },
                ],
                rows: regularPurchases.map((p, i) => [
                    String(i + 1),
                    p.invoiceNo ?? `PO-${p.id}`,
                    fmtDate(p.date),
                    fmtCurrency(p.totalAmount),
                    fmtCurrency(p.paidAmount),
                    fmtCurrency(Math.max(0, p.totalAmount - p.paidAmount)),
                    String(p.items?.length ?? 0),
                ]),
                totalRow: [
                    { text: "Total", colSpan: 3 },
                    fmtCurrency(totalPurchases),
                    fmtCurrency(totalPaid),
                    fmtCurrency(totalPurchases - totalPaid),
                    String(totalItems),
                ],
            });
        }

        if (returns.length > 0) {
            report.section("Returns", `${returns.length} return(s)`);
            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Date", width: 90, align: "center" },
                    { label: "Invoice", width: "*" },
                    { label: "Items", width: 60, align: "center" },
                    { label: "Amount", width: 100, align: "right" },
                ],
                rows: returns.map((r, i) => [
                    String(i + 1),
                    fmtDate(r.date),
                    r.invoiceNo ?? `PRTN-${r.id}`,
                    String(r.items?.length ?? 0),
                    { text: fmtCurrency(r.totalAmount), align: "right" as const, tone: "warning" as const },
                ]),
                totalRow: [{ text: "Total Returns", colSpan: 4 }, fmtCurrency(totalReturns)],
            });
        }

        if (payments.length > 0) {
            report.section("Payments", `${payments.length} payment(s)`);
            report.table({
                columns: [
                    { label: "#", width: 28, align: "center" },
                    { label: "Date", width: 90, align: "center" },
                    { label: "Account", width: "*" },
                    { label: "Amount", width: 100, align: "right" },
                ],
                rows: payments.map((p, i) => [
                    String(i + 1),
                    fmtDate(p.date),
                    p.account?.name ?? "N/A",
                    fmtCurrency(p.amount),
                ]),
                totalRow: [{ text: "Total Payments", colSpan: 3 }, fmtCurrency(totalPayments)],
            });
        }

        report.signatures(SIGN_OFF);
        await sendReport(res, report);
    } catch (error) {
        console.error("Supplier business report PDF error:", error);
        res.status(500).json({ error: "Failed to generate supplier business report", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

export const getSupplierDetailedPurchasesReportPDF = async (req: Request, res: Response): Promise<void> => {
    const { from, to, supplierId } = req.query;
    const where: any = {};
    if (from) where.date = { ...where.date, gte: new Date(`${from}T00:00:00.000`) };
    if (to) where.date = { ...where.date, lte: new Date(`${to}T23:59:59.999`) };
    if (supplierId) {
        where.supplierId = parseInt(supplierId as string);
    }

    try {
        const purchases = await prisma.purchase.findMany({
            where,
            orderBy: { date: "desc" },
            include: {
                supplier: { select: { name: true } },
                items: { include: { product: { select: { name: true } } } },
            },
        });

        const totalCost = purchases.reduce((s, p) => s + p.totalAmount, 0);
        const totalPaid = purchases.reduce((s, p) => s + p.paidAmount, 0);
        const totalDue = totalCost - totalPaid;
        const totalDiscount = purchases.reduce((s, p) => s + p.discount, 0);
        const totalTax = purchases.reduce((s, p) => s + p.taxAmount, 0);

        let supName = "All";
        if (supplierId) {
            const s = await prisma.supplier.findUnique({ where: { id: parseInt(supplierId as string) }, select: { name: true } });
            if (s) supName = s.name;
        }

        const report = createReport({
            title: "Detailed Purchases Report",
            subtitle: "Line-item breakdown per purchase order",
            filename: reportFilename("detailed-purchases-report"),
            orientation: "landscape",
            filters: {
                From: from ? fmtDate(from as string) : "All Time",
                To: to ? fmtDate(to as string) : "Now",
                Supplier: supName,
                Orders: purchases.length,
            },
        });

        report.stats([
            { label: "Total Purchases", value: fmtCurrency(totalCost), tone: "primary", note: `${purchases.length} orders` },
            { label: "Amount Paid", value: fmtCurrency(totalPaid), tone: "success" },
            { label: "Payable Due", value: fmtCurrency(totalDue), tone: totalDue > 0 ? "danger" : "muted" },
            { label: "Discounts Received", value: fmtCurrency(totalDiscount), tone: "warning" },
            { label: "Tax Paid", value: fmtCurrency(totalTax) },
        ]);

        report.section("Purchase Orders", `${purchases.length} record(s)`);

        if (purchases.length === 0) {
            report.note("No purchases were recorded for the selected period.");
        } else {
            const rows: TableCell[][] = purchases.map((p, i) => {
                const itemLines = p.items
                    .map((item) => `${item.product?.name || "Product"} - ${item.quantity} x ${item.unitCost}`)
                    .join("\n");
                const due = p.totalAmount - p.paidAmount;

                return [
                    String(i + 1),
                    fmtDate(p.date, "DD-MM-YYYY"),
                    p.invoiceNo ?? `PO-${p.id}`,
                    p.supplier?.name ?? "N/A",
                    itemLines || "No items",
                    fmtCurrency(p.discount),
                    fmtCurrency(p.taxAmount),
                    fmtCurrency(p.totalAmount),
                    fmtCurrency(p.paidAmount),
                    { text: fmtCurrency(due), align: "right" as const, tone: due > 0 ? ("danger" as const) : undefined },
                ];
            });

            report.table({
                columns: [
                    { label: "#", width: 24, align: "center" },
                    { label: "Date", width: 74, align: "center" },
                    { label: "Invoice", width: 78, align: "center" },
                    { label: "Supplier", width: 96 },
                    { label: "Items (product · qty × cost)", width: "*", wrap: true },
                    { label: "Discount", width: 58, align: "right" },
                    { label: "Tax", width: 50, align: "right" },
                    { label: "Total", width: 66, align: "right" },
                    { label: "Paid", width: 66, align: "right" },
                    { label: "Due", width: 64, align: "right" },
                ],
                rows,
                totalRow: [
                    { text: "Grand Total", colSpan: 5 },
                    fmtCurrency(totalDiscount),
                    fmtCurrency(totalTax),
                    fmtCurrency(totalCost),
                    fmtCurrency(totalPaid),
                    fmtCurrency(totalDue),
                ],
                fontSize: 7.5,
            });
        }

        await sendReport(res, report);
    } catch (error) {
        console.error("Detailed purchases report PDF error:", error);
        res.status(500).json({ error: "Failed to generate detailed purchases report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

async function getCategoryIdsRecursively(categoryId: number): Promise<number[]> {
    const ids = [categoryId];
    const subcats = await prisma.category.findMany({
        where: { parentId: categoryId },
        select: { id: true }
    });
    for (const sub of subcats) {
        const subIds = await getCategoryIdsRecursively(sub.id);
        ids.push(...subIds);
    }
    return ids;
}

export const getPurchaseOrderRecommendationPDF = async (req: Request, res: Response): Promise<void> => {
    try {
        req.setTimeout(120_000);

        const from = req.query.from as string | undefined;
        const to = req.query.to as string | undefined;
        const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
        const brandId = req.query.brandId ? Number(req.query.brandId) : undefined;

        // Default: last 30 days
        const fromDate = from ? dayjs(from).startOf("day").toDate() : dayjs().subtract(30, "day").startOf("day").toDate();
        const toDate = to ? dayjs(to).endOf("day").toDate() : dayjs().endOf("day").toDate();
        const days = Math.max(1, dayjs(toDate).diff(dayjs(fromDate), "day") + 1);

        const whereClause: any = { active: true, isService: false };
        if (categoryId) {
            const categoryIds = await getCategoryIdsRecursively(categoryId);
            whereClause.categoryId = { in: categoryIds };
        }
        if (brandId) {
            whereClause.brandId = brandId;
        }

        const products = await prisma.product.findMany({
            where: whereClause,
            select: {
                id: true,
                name: true,
                totalStock: true,
                reorderLevel: true,
                avgCostPrice: true,
                categoryId: true,
                category: { select: { name: true } },
                brand: { select: { name: true } },
                variants: { select: { price: true, barcode: true }, take: 1 },
            },
            orderBy: { name: "asc" },
        });

        const scope: Record<string, string | number> = {};
        if (categoryId) {
            const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } });
            if (cat) scope.Category = cat.name;
        }
        if (brandId) {
            const br = await prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } });
            if (br) scope.Brand = br.name;
        }

        if (products.length === 0) {
            const empty = createReport({
                title: "Purchase Order Recommendation",
                subtitle: "Supplier and quantity recommendations from sales velocity",
                filename: reportFilename("purchase-order-recommendation"),
                orientation: "landscape",
                filters: { ...scope, Products: 0 },
            });
            empty.note("No products found matching the selected filters.");
            await sendReport(res, empty);
            return;
        }

        // 1. Sales quantities of these products in the date range.
        const saleItems = await prisma.saleItem.findMany({
            where: {
                sale: { createdAt: { gte: fromDate, lte: toDate } },
                variant: { productId: { in: products.map(p => p.id) } },
            },
            select: {
                quantity: true,
                variant: { select: { productId: true, factor: true } },
            },
        });

        const salesByProductId: Record<number, number> = {};
        for (const item of saleItems) {
            const prodId = item.variant.productId;
            salesByProductId[prodId] = (salesByProductId[prodId] || 0) + item.quantity * (item.variant.factor || 1);
        }

        // 2. Most recent supplier per product.
        const purchaseItems = await prisma.purchaseItem.findMany({
            where: { productId: { in: products.map(p => p.id) } },
            select: {
                productId: true,
                purchase: {
                    select: {
                        date: true,
                        supplier: { select: { id: true, name: true, phone: true } },
                    },
                },
            },
            orderBy: { purchase: { date: "desc" } },
        });

        const supplierByProductId: Record<number, { id: number; name: string; phone: string | null }> = {};
        for (const item of purchaseItems) {
            const prodId = item.productId;
            if (item.purchase?.supplier && !supplierByProductId[prodId]) {
                supplierByProductId[prodId] = item.purchase.supplier;
            }
        }

        // 3. Category fallback supplier mapping.
        const categoryPurchaseItems = await prisma.purchaseItem.findMany({
            where: { product: { categoryId: { in: products.map(p => p.categoryId) } } },
            select: {
                product: { select: { categoryId: true } },
                purchase: {
                    select: { supplier: { select: { id: true, name: true, phone: true } } },
                },
            },
            orderBy: { purchase: { date: "desc" } },
        });

        const categorySuppliers: Record<number, { id: number; name: string; phone: string | null }> = {};
        for (const item of categoryPurchaseItems) {
            const catId = item.product.categoryId;
            const sup = item.purchase.supplier;
            if (sup && !categorySuppliers[catId]) {
                categorySuppliers[catId] = sup;
            }
        }

        // 4. Compute recommendations.
        const rows = products.map((product) => {
            const currentStock = product.totalStock;
            const reorderLevel = product.reorderLevel;
            const soldBaseQty = salesByProductId[product.id] || 0;
            const velocity = soldBaseQty / days;

            // Forecast covers the same length of period.
            const forecastDemand = Math.round(velocity * days);
            const needsReorder = currentStock <= reorderLevel || currentStock < forecastDemand;

            // Build a healthy buffer: the forecast, or double the reorder level.
            const targetStock = Math.max(forecastDemand, reorderLevel * 2);
            const recommendedQty = needsReorder ? Math.max(0, targetStock - currentStock) : 0;

            const cost = safeAvgCost(product.avgCostPrice, product.variants[0]?.price ?? 0);

            let recSupplier = supplierByProductId[product.id];
            let supplierType = "Direct";
            if (!recSupplier) {
                recSupplier = categorySuppliers[product.categoryId];
                supplierType = recSupplier ? "Category" : "N/A";
            }

            return {
                name: product.name,
                category: product.category.name,
                brand: product.brand?.name ?? "N/A",
                barcode: product.variants[0]?.barcode ?? "—",
                currentStock,
                reorderLevel,
                soldQty: soldBaseQty,
                recommendedQty,
                avgCost: cost,
                estCost: recommendedQty * cost,
                supplier: recSupplier ? `${recSupplier.name}${recSupplier.phone ? ` (${recSupplier.phone})` : ""}` : "No History",
                supplierType,
            };
        }).filter(row => row.recommendedQty > 0);

        const totalInvestment = rows.reduce((s, r) => s + r.estCost, 0);
        const totalQty = rows.reduce((s, r) => s + r.recommendedQty, 0);

        const report = createReport({
            title: "Purchase Order Recommendation",
            subtitle: "Supplier and quantity recommendations from sales velocity",
            filename: reportFilename("purchase-order-recommendation"),
            orientation: "landscape",
            filters: {
                ...scope,
                Period: `${fmtDate(fromDate)} — ${fmtDate(toDate)}`,
                "Lookback": `${days} days`,
            },
        });

        report.stats([
            { label: "Products to Order", value: String(rows.length), tone: rows.length ? "warning" : "success" },
            { label: "Units Recommended", value: fmtCurrency(totalQty), tone: "primary" },
            { label: "Estimated Investment", value: fmtCurrency(totalInvestment), tone: "primary" },
            { label: "Velocity Lookback", value: `${days} days`, tone: "muted", note: `${fmtDate(fromDate)} — ${fmtDate(toDate)}` },
        ]);

        report.section("Recommended Orders", `${rows.length} product(s)`);

        if (rows.length === 0) {
            report.note("All products have sufficient stock based on sales velocity and reorder thresholds.");
        } else {
            const tableRows: TableCell[][] = rows.map((row, i) => [
                String(i + 1),
                row.name,
                row.barcode,
                row.brand,
                row.category,
                String(row.currentStock),
                String(row.reorderLevel),
                String(row.soldQty),
                { text: String(row.recommendedQty), align: "center" as const, bold: true, tone: "primary" as const },
                fmtCurrency(row.avgCost),
                fmtCurrency(row.estCost),
                `${row.supplier} [${row.supplierType}]`,
            ]);

            report.table({
                columns: [
                    { label: "#", width: 22, align: "center" },
                    { label: "Product", width: "*" },
                    { label: "Barcode", width: 72, align: "center" },
                    { label: "Brand", width: 62 },
                    { label: "Category", width: 68 },
                    { label: "Stock", width: 40, align: "center" },
                    { label: "Reorder", width: 46, align: "center" },
                    { label: "Sold", width: 40, align: "center" },
                    { label: "Order Qty", width: 52, align: "center" },
                    { label: "Avg Cost", width: 56, align: "right" },
                    { label: "Est. Cost", width: 62, align: "right" },
                    { label: "Recommended Supplier", width: 128 },
                ],
                rows: tableRows,
                totalRow: [
                    { text: "Grand Total", colSpan: 8 },
                    String(totalQty),
                    "",
                    fmtCurrency(totalInvestment),
                    "",
                ],
                fontSize: 7.5,
            });
        }

        report.signatures(SIGN_OFF);
        await sendReport(res, report);
    } catch (error) {
        console.error("Purchase order recommendation PDF error:", error);
        res.status(500).json({ error: "Failed to generate purchase order recommendation report", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
