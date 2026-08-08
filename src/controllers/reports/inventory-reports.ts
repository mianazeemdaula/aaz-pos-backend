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
import type { Tone } from "../../utils/pdf/report-theme";

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

/** Resolve the optional category/brand filters into display names. */
async function resolveScope(categoryId?: number, brandId?: number) {
    const scope: Record<string, string> = {};
    if (categoryId) {
        const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } });
        if (cat) scope.Category = cat.name;
    }
    if (brandId) {
        const br = await prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } });
        if (br) scope.Brand = br.name;
    }
    return scope;
}

export const getInventoryReportPDF = async (req: Request, res: Response): Promise<void> => {
    try {
        // Set a longer timeout for large inventories
        req.setTimeout(120_000);

        const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
        const brandId = req.query.brandId ? Number(req.query.brandId) : undefined;

        const whereClause: any = { active: true };
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
                category: { select: { name: true } },
                brand: { select: { name: true } },
                variants: { select: { price: true }, take: 1 },
            },
            orderBy: { name: "asc" },
        });

        const lowStock = products.filter((p) => p.totalStock > 0 && p.totalStock <= p.reorderLevel);
        const outOfStock = products.filter((p) => p.totalStock <= 0);
        const totalValue = products.reduce((s, p) => s + p.totalStock * safeAvgCost(p.avgCostPrice, p.variants[0]?.price ?? 0), 0);
        const totalUnits = products.reduce((s, p) => s + p.totalStock, 0);

        const report = createReport({
            title: "Inventory Report",
            subtitle: "Product stock overview and valuation",
            filename: reportFilename("inventory-report"),
            orientation: "landscape",
            filters: {
                ...(await resolveScope(categoryId, brandId)),
                Products: products.length,
            },
        });

        report.stats([
            { label: "Total Products", value: String(products.length), tone: "primary" },
            { label: "Units in Stock", value: fmtCurrency(totalUnits) },
            { label: "Inventory Value", value: fmtCurrency(totalValue), tone: "primary", note: "at average cost" },
            { label: "Low Stock Items", value: String(lowStock.length), tone: lowStock.length ? "warning" : "muted" },
            { label: "Out of Stock", value: String(outOfStock.length), tone: outOfStock.length ? "danger" : "muted" },
        ]);

        report.section("Products", `${products.length} record(s)`);

        if (products.length === 0) {
            report.note("No active products matched the selected filters.");
        } else {
            const rowTones: (Tone | undefined)[] = [];
            const rows: TableCell[][] = products.map((p, i) => {
                const avgCost = safeAvgCost(p.avgCostPrice, p.variants[0]?.price ?? 0);
                const out = p.totalStock <= 0;
                const low = !out && p.totalStock <= p.reorderLevel;
                rowTones.push(out ? "danger" : low ? "warning" : undefined);

                return [
                    String(i + 1),
                    p.name,
                    p.category.name,
                    p.brand?.name ?? "N/A",
                    fmtCurrency(p.totalStock),
                    fmtCurrency(p.reorderLevel),
                    fmtCurrency(avgCost),
                    fmtCurrency(p.totalStock * avgCost),
                    {
                        text: out ? "OUT OF STOCK" : low ? "LOW" : "OK",
                        align: "center" as const,
                        bold: out || low,
                        tone: out ? ("danger" as const) : low ? ("warning" as const) : ("success" as const),
                    },
                ];
            });

            report.table({
                columns: [
                    { label: "#", width: 35, align: "center" },
                    { label: "Product", width: "*" },
                    { label: "Category", width: 92 },
                    { label: "Brand", width: 80 },
                    { label: "Stock", width: 62, align: "right" },
                    { label: "Reorder", width: 62, align: "right" },
                    { label: "Avg Cost", width: 74, align: "right" },
                    { label: "Stock Value", width: 88, align: "right" },
                    { label: "Status", width: 84, align: "center" },
                ],
                rows,
                rowTones,
                totalRow: [
                    { text: "Grand Total", colSpan: 4 },
                    fmtCurrency(totalUnits),
                    "",
                    "",
                    fmtCurrency(totalValue),
                    "",
                ],
            });
        }

        await sendReport(res, report);
    } catch (error) {
        console.error("Inventory report PDF error:", error);
        res.status(500).json({ error: "Failed to generate inventory report PDF", message: error instanceof Error ? error.message : "Unknown error" });
    }
};

export const getStockReportPDF = async (req: Request, res: Response): Promise<void> => {
    const filter = (req.query.filter as string) ?? "all"; // all | negative | low | alert
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
    const brandId = req.query.brandId ? Number(req.query.brandId) : undefined;

    try {
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

        let listed = products;
        let title = "Full Stock Report";
        if (filter === "negative") { listed = negative; title = "Negative Stock Report"; }
        else if (filter === "low") { listed = lowStock; title = "Low Stock Report"; }
        else if (filter === "alert") { listed = [...negative, ...lowStock]; title = "Stock Alert Report"; }

        const report = createReport({
            title,
            subtitle: "Inventory stock levels",
            filename: `stock-report-${filter}-${dayjs().format("YYYY-MM-DD")}.pdf`,
            orientation: "landscape",
            filters: {
                ...(await resolveScope(categoryId, brandId)),
                Listed: listed.length,
                "As of": fmtDate(new Date()),
            },
        });

        report.stats([
            { label: "Listed Products", value: String(listed.length), tone: "primary" },
            { label: "Negative Stock", value: String(negative.length), tone: negative.length ? "danger" : "muted" },
            { label: "Low Stock", value: String(lowStock.length), tone: lowStock.length ? "warning" : "muted" },
            { label: "Healthy Stock", value: String(normal.length), tone: "success" },
        ]);

        report.section("Stock Levels", `${listed.length} record(s)`);

        if (listed.length === 0) {
            report.note("No products matched this stock filter.");
        } else {
            const rowTones: (Tone | undefined)[] = [];
            const rows: TableCell[][] = listed.map((p, i) => {
                const defaultVariant = p.variants.find(v => v.isDefault) ?? p.variants[0];
                const isNegative = p.totalStock < 0;
                const isLow = !isNegative && p.totalStock <= p.reorderLevel;
                rowTones.push(isNegative ? "danger" : isLow ? "warning" : undefined);

                return [
                    String(i + 1),
                    p.name,
                    p.category.name,
                    defaultVariant?.barcode ?? "—",
                    String(p.totalStock),
                    String(p.reorderLevel),
                    fmtCurrency(safeAvgCost(p.avgCostPrice, defaultVariant?.price ?? 0)),
                    {
                        text: isNegative ? "NEGATIVE" : isLow ? "LOW" : "OK",
                        align: "center" as const,
                        bold: isNegative || isLow,
                        tone: isNegative ? ("danger" as const) : isLow ? ("warning" as const) : ("success" as const),
                    },
                ];
            });

            report.table({
                columns: [
                    { label: "#", width: 26, align: "center" },
                    { label: "Product Name", width: "*" },
                    { label: "Category", width: 120 },
                    { label: "Barcode", width: 100, align: "center" },
                    { label: "Stock", width: 60, align: "center" },
                    { label: "Reorder", width: 66, align: "center" },
                    { label: "Avg Cost", width: 78, align: "right" },
                    { label: "Status", width: 82, align: "center" },
                ],
                rows,
                rowTones,
            });
        }

        await sendReport(res, report);
    } catch (error) {
        console.error("Stock report PDF error:", error);
        res.status(500).json({ error: "Failed to generate stock report PDF" });
    }
};

export const getCostAboveSalePriceReportPDF = async (req: Request, res: Response): Promise<void> => {
    try {
        req.setTimeout(120_000);

        const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
        const brandId = req.query.brandId ? Number(req.query.brandId) : undefined;

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
            include: {
                category: { select: { name: true } },
                brand: { select: { name: true } },
                variants: { select: { id: true, name: true, barcode: true, price: true, retail: true, wholesale: true, factor: true, isDefault: true } },
            },
            orderBy: { name: "asc" },
        });

        interface LossRow {
            sno: number;
            variantName: string;
            barcode: string;
            category: string;
            unitCost: number;
            sellingPrice: number;
            lossPerUnit: number;
            stock: number;
            potentialLoss: number;
        }

        const lossRows: LossRow[] = [];
        let totalPotentialLoss = 0;

        for (const p of products) {
            const baseAvgCost = p.avgCostPrice || 0;
            if (baseAvgCost <= 0) continue;

            for (const v of p.variants) {
                const unitCost = baseAvgCost * (v.factor || 1);
                const sellingPrice = v.retail != null ? v.retail : v.price;
                if (unitCost > sellingPrice) {
                    const lossPerUnit = unitCost - sellingPrice;
                    const potentialLoss = p.totalStock > 0 ? lossPerUnit * p.totalStock : 0;
                    totalPotentialLoss += potentialLoss;

                    lossRows.push({
                        sno: lossRows.length + 1,
                        variantName: v.isDefault ? p.name : `${p.name} (${v.name})`,
                        barcode: v.barcode ?? "—",
                        category: p.category.name,
                        unitCost,
                        sellingPrice,
                        lossPerUnit,
                        stock: p.totalStock,
                        potentialLoss,
                    });
                }
            }
        }

        const impactedStock = lossRows.reduce((s, r) => s + Math.max(0, r.stock), 0);

        const report = createReport({
            title: "Cost Above Sale Price",
            subtitle: "Items priced below their average cost",
            filename: reportFilename("cost-above-sale-price-report"),
            orientation: "landscape",
            filters: {
                ...(await resolveScope(categoryId, brandId)),
                "Loss-Making Items": lossRows.length,
                "As of": fmtDate(new Date()),
            },
        });

        report.stats([
            { label: "Loss-Making Items", value: String(lossRows.length), tone: lossRows.length ? "danger" : "success" },
            { label: "Stock Impacted", value: fmtCurrency(impactedStock), tone: "warning" },
            {
                label: "Potential Loss",
                value: fmtCurrency(totalPotentialLoss),
                tone: "danger",
                note: "if sold at current price",
            },
        ]);

        report.section("Affected Products", `${lossRows.length} variant(s)`);

        if (lossRows.length === 0) {
            report.note("No products are currently priced below their average cost. Nothing to act on.");
        } else {
            const rows: TableCell[][] = lossRows.map((r) => [
                String(r.sno),
                r.variantName,
                r.category,
                r.barcode,
                String(r.stock),
                fmtCurrency(r.unitCost),
                fmtCurrency(r.sellingPrice),
                { text: fmtCurrency(r.lossPerUnit), align: "right" as const, tone: "danger" as const },
                { text: fmtCurrency(r.potentialLoss), align: "right" as const, tone: "danger" as const },
            ]);

            report.table({
                columns: [
                    { label: "#", width: 26, align: "center" },
                    { label: "Product / Variant", width: "*" },
                    { label: "Category", width: 96 },
                    { label: "Barcode", width: 92, align: "center" },
                    { label: "Stock", width: 54, align: "center" },
                    { label: "Unit Cost", width: 76, align: "right" },
                    { label: "Sale Price", width: 76, align: "right" },
                    { label: "Loss / Unit", width: 76, align: "right" },
                    { label: "Potential Loss", width: 88, align: "right" },
                ],
                rows,
                totalRow: [
                    { text: "Total Potential Loss", colSpan: 8 },
                    fmtCurrency(totalPotentialLoss),
                ],
            });
        }

        await sendReport(res, report);
    } catch (error) {
        console.error("Cost > Sale Price report PDF error:", error);
        res.status(500).json({ error: "Failed to generate Cost > Sale Price report PDF" });
    }
};
