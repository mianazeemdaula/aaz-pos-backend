import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import {
    fmtDate,
    fmtCurrency,
    pdfConfig,
    generateQRBuffer,
    createPDFGenerator,
    safeAvgCost
} from "./helpers";

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

        const meta: Record<string, string | number> = {
            "Total Products": products.length,
            "Low Stock": lowStock.length,
            "Out of Stock": outOfStock.length,
            "Total Value": fmtCurrency(totalValue),
        };

        if (categoryId) {
            const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } });
            if (cat) meta["Category"] = cat.name;
        }
        if (brandId) {
            const br = await prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } });
            if (br) meta["Brand"] = br.name;
        }

        const qr = await generateQRBuffer(`Inventory Report | ${dayjs().format("DD-MM-YYYY")} | Products: ${products.length} | Value: ${fmtCurrency(totalValue)}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Inventory Report", "Product Stock Overview", meta, "landscape", "A4", qr)
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

export const getStockReportPDF = async (req: Request, res: Response): Promise<void> => {
    const filter = (req.query.filter as string) ?? "all"; // all | negative | low
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

        let rows = products;
        let title = "Full Stock Report";
        if (filter === "negative") { rows = negative; title = "Negative Stock Report"; }
        else if (filter === "low") { rows = lowStock; title = "Low Stock Report"; }
        else if (filter === "alert") { rows = [...negative, ...lowStock]; title = "Stock Alert Report"; }

        const meta: Record<string, string | number> = {
            "Total Products": rows.length,
            "Negative Stock": negative.length,
            "Low Stock": lowStock.length,
            "Normal Stock": normal.length,
            "Generated": fmtDate(new Date()),
        };

        if (categoryId) {
            const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } });
            if (cat) meta["Category"] = cat.name;
        }
        if (brandId) {
            const br = await prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } });
            if (br) meta["Brand"] = br.name;
        }

        const stockQr = await generateQRBuffer(`${title} | Products: ${rows.length} | Negative: ${negative.length} | Low: ${lowStock.length}`);
        const pdfGen = createPDFGenerator(pdfConfig(
            title,
            "Inventory Stock Levels",
            meta,
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
            productName: string;
            variantName: string;
            barcode: string;
            category: string;
            brand: string;
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
                        productName: p.name,
                        variantName: v.isDefault ? p.name : `${p.name} (${v.name})`,
                        barcode: v.barcode ?? "—",
                        category: p.category.name,
                        brand: p.brand?.name ?? "N/A",
                        unitCost,
                        sellingPrice,
                        lossPerUnit,
                        stock: p.totalStock,
                        potentialLoss,
                    });
                }
            }
        }

        const meta: Record<string, string | number> = {
            "Loss-Making Items": lossRows.length,
            "Total Potential Loss": fmtCurrency(totalPotentialLoss),
            "Generated": fmtDate(new Date()),
        };

        if (categoryId) {
            const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } });
            if (cat) meta["Category"] = cat.name;
        }
        if (brandId) {
            const br = await prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } });
            if (br) meta["Brand"] = br.name;
        }

        const qr = await generateQRBuffer(`Cost > Sale Price Report | Items: ${lossRows.length} | Potential Loss: ${fmtCurrency(totalPotentialLoss)}`);
        const pdfGen = createPDFGenerator(pdfConfig(
            "Cost > Sale Price Report",
            "Products & Variants where Cost Price exceeds Sale Price",
            meta,
            "landscape",
            "A4",
            qr
        ));
        const doc = pdfGen.getDocument();

        // Summary table
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#fee2e2", fontSize: 10, fontStyle: "bold", textColor: "#991b1b" } : {},
        });
        summaryTable.row([
            { text: "Loss-Making Items", align: { x: "left", y: "center" } },
            { text: "Total Stock Impacted", align: { x: "left", y: "center" } },
            { text: "Total Potential Inventory Loss", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: lossRows.length.toString(), align: { x: "left", y: "center" } },
            { text: lossRows.reduce((s, r) => s + Math.max(0, r.stock), 0).toString(), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalPotentialLoss), align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();

        pdfGen.moveDown(0.5);

        // Details table
        doc.x = doc.page.margins.left;
        const table = doc.table({
            columnStyles: [30, "*", 90, 80, 50, 70, 70, 70, 85],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#1e293b", textColor: "#ffffff", fontSize: 9, fontStyle: "bold" } : { backgroundColor: row % 2 === 0 ? "#fef2f2" : "#ffffff" },
        });

        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Product / Variant", align: { x: "left", y: "center" } },
            { text: "Category", align: { x: "left", y: "center" } },
            { text: "Barcode", align: { x: "center", y: "center" } },
            { text: "Stock", align: { x: "center", y: "center" } },
            { text: "Unit Cost", align: { x: "right", y: "center" } },
            { text: "Sale Price", align: { x: "right", y: "center" } },
            { text: "Loss/Unit", align: { x: "right", y: "center" } },
            { text: "Pot. Loss", align: { x: "right", y: "center" } },
        ]);

        if (lossRows.length === 0) {
            table.row([
                { text: "No products found with Cost > Sale Price.", colSpan: 9, align: { x: "center", y: "center" } }
            ]);
        } else {
            lossRows.forEach((r) => {
                table.row([
                    { text: String(r.sno), align: { x: "center", y: "center" } },
                    { text: r.variantName, align: { x: "left", y: "center" } },
                    { text: r.category, align: { x: "left", y: "center" } },
                    { text: r.barcode, align: { x: "center", y: "center" } },
                    { text: String(r.stock), align: { x: "center", y: "center" } },
                    { text: fmtCurrency(r.unitCost), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(r.sellingPrice), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(r.lossPerUnit), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(r.potentialLoss), align: { x: "right", y: "center" } },
                ]);
            });

            doc.fontSize(9);
            table.row([
                { text: "Total Potential Loss", colSpan: 8, align: { x: "justify", y: "center" } },
                { text: fmtCurrency(totalPotentialLoss), align: { x: "right", y: "center" } },
            ]);
        }

        table.end();

        await pdfGen.sendToResponse(res, `cost-above-sale-price-report-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Cost > Sale Price report PDF error:", error);
        res.status(500).json({ error: "Failed to generate Cost > Sale Price report PDF" });
    }
};
