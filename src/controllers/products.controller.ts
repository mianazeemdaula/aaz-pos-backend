import e, { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

// ---- PRODUCTS ----

export const listProducts = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip, q } = getPaginationParams(req);
    const where: any = {};
    if (q) {
        where.OR = [
            { name: { contains: q, mode: "insensitive" } },
            { variants: { some: { barcode: { contains: q, mode: "insensitive" } } } }
        ];
    }
    if (req.query.categoryId) where.categoryId = parseInt(req.query.categoryId as string);
    if (req.query.brandId) where.brandId = parseInt(req.query.brandId as string);
    if (req.query.active !== undefined) where.active = req.query.active === "true";
    if (req.query.lowStock === "true") {
        where.totalStock = { lte: prisma.product.fields.reorderLevel };
    }

    try {
        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where,
                skip, take: pageSize,
                orderBy: { name: "asc" },
                include: {
                    brand: true,
                    category: true,
                    variants: true,
                    taxSchdule: true,
                },
            }),
            prisma.product.count({ where }),
        ]);
        res.json(createPaginatedResponse(products, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch products" });
    }
};

export const getProduct = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const product = await prisma.product.findUnique({
            where: { id },
            include: {
                brand: true,
                category: true,
                variants: true,
                taxSchdule: true,
                stockMovements: { orderBy: { createdAt: "desc" }, take: 20 },
            },
        });
        if (!product) { res.status(404).json({ error: "Product not found" }); return; }
        res.json(product);
    } catch {
        res.status(500).json({ error: "Failed to fetch product" });
    }
};

export const createProduct = async (req: Request, res: Response): Promise<void> => {
    const { name, brandId, categoryId, reorderLevel, allowNegative, imageUrl, hsCode, taxSchduleId, taxMethod, taxRate, active, isService, showBarcodePrice, isFavorite, saleBelowCost, variants, costPrice, stock } = req.body;
    if (!name || !categoryId) {
        res.status(400).json({ error: "name and categoryId are required" });
        return;
    }
    try {
        const initialCostPrice = costPrice !== undefined && costPrice !== null ? Number(costPrice) : (variants?.[0]?.price * 0.90 || 0);
        const initialStock = stock !== undefined && stock !== null ? Number(stock) : 0;
        const product = await prisma.product.create({
            data: {
                name, brandId, categoryId,
                reorderLevel, allowNegative, imageUrl, hsCode, taxSchduleId,
                taxMethod, taxRate, active,
                isService, showBarcodePrice, isFavorite, saleBelowCost,
                avgCostPrice: initialCostPrice,
                totalStock: initialStock,
                variants: variants?.length ? {
                    create: (() => {
                        const defaultV = variants.find((v: any) => v.isDefault) || variants[0];
                        return variants.map((v: any, i: number) => {
                            const isDefault = v.isDefault || (i === 0 && !variants.some((x: any) => x.isDefault));
                            const factor = v.factor ?? 1;
                            let price = v.price;
                            let retail = v.retail == 0 ? v.price : v.retail;
                            let wholesale = v.wholesale == 0 ? v.price : v.wholesale;
                            if (!isDefault && defaultV) {
                                price = defaultV.price * factor;
                                retail = (defaultV.retail == 0 || !defaultV.retail ? defaultV.price : defaultV.retail) * factor;
                                wholesale = (defaultV.wholesale == 0 || !defaultV.wholesale ? defaultV.price : defaultV.wholesale) * factor;
                            }
                            return {
                                name: v.name,
                                barcode: v.barcode,
                                price,
                                retail,
                                wholesale,
                                factor,
                                isDefault,
                            };
                        });
                    })(),
                } : undefined,
                stockMovements: initialStock !== 0 ? {
                    create: {
                        type: "OPENING",
                        quantity: initialStock,
                        note: "Opening Stock",
                    }
                } : undefined,
            },
            include: { brand: true, category: true, variants: true },
        });
        res.status(201).json(product);
    } catch (error) {
        console.error("Create product error:", error);
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error as any).code === "P2002" &&
            "meta" in error &&
            (error as any).meta?.target?.includes("barcode")
        ) {
            res.status(400).json({ error: "Barcode already exists for another variant" });
            return;
        }
        res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create product — barcode may already exist" });
    }
}

export const updateProduct = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { name, brandId, categoryId, reorderLevel, allowNegative, imageUrl, hsCode, taxSchduleId, taxMethod, taxRate, active, isService, showBarcodePrice, isFavorite, saleBelowCost, costPrice, stock } = req.body;
    try {
        const currentProduct = await prisma.product.findUnique({ where: { id } });
        if (!currentProduct) {
            res.status(404).json({ error: "Product not found" });
            return;
        }

        const updateData: any = { name, brandId, categoryId, reorderLevel, allowNegative, imageUrl, hsCode, taxSchduleId, taxMethod, taxRate, active, isService, showBarcodePrice, isFavorite, saleBelowCost };
        
        if (costPrice !== undefined && costPrice !== null) {
            updateData.avgCostPrice = Number(costPrice);
        }

        if (stock !== undefined && stock !== null) {
            const parsedStock = Number(stock);
            if (parsedStock !== currentProduct.totalStock) {
                const stockDiff = parsedStock - currentProduct.totalStock;
                updateData.totalStock = parsedStock;
                updateData.stockMovements = {
                    create: {
                        type: "ADJUSTMENT",
                        quantity: stockDiff,
                        note: "Product edit manual adjustment",
                    }
                };
            }
        }

        const product = await prisma.product.update({
            where: { id },
            data: updateData,
            include: { brand: true, category: true, variants: true },
        });
        res.json(product);
    } catch (error) {
        console.error("Update product error:", error);
        res.status(500).json({ error: "Failed to update product" });
    }
};

export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        await prisma.product.delete({ where: { id } });
        res.json({ message: "Product deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete product — it may be in use" });
    }
};

// ---- PRODUCT VARIANTS ----

export const listVariants = async (req: Request, res: Response): Promise<void> => {
    const productId = parseInt(req.params.id);
    try {
        const variants = await prisma.productVariant.findMany({
            where: { productId },
            orderBy: { isDefault: "desc" },
        });
        res.json(variants);
    } catch {
        res.status(500).json({ error: "Failed to fetch variants" });
    }
};

export const getVariant = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.variantId);
    try {
        const variant = await prisma.productVariant.findUnique({ where: { id } });
        if (!variant) { res.status(404).json({ error: "Variant not found" }); return; }
        res.json(variant);
    } catch {
        res.status(500).json({ error: "Failed to fetch variant" });
    }
};

export const createVariant = async (req: Request, res: Response): Promise<void> => {
    const productId = parseInt(req.params.id);
    const { name, barcode, price, retail, wholesale, factor } = req.body;
    if (!name || !barcode) {
        res.status(400).json({ error: "name and barcode are required" });
        return;
    }
    try {
        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: { variants: true }
        });
        if (!product) { res.status(404).json({ error: "Product not found" }); return; }

        const defaultVariant = product.variants.find(v => v.isDefault) || product.variants[0];
        const f = factor ?? 1;

        let finalPrice = price;
        let finalRetail = retail;
        let finalWholesale = wholesale;

        if (defaultVariant) {
            finalPrice = defaultVariant.price * f;
            finalRetail = (defaultVariant.retail ?? defaultVariant.price) * f;
            finalWholesale = (defaultVariant.wholesale ?? defaultVariant.price) * f;
        } else {
            finalPrice = price ?? 0;
            finalRetail = retail == 0 ? finalPrice : (retail ?? finalPrice);
            finalWholesale = wholesale == 0 ? finalPrice : (wholesale ?? finalPrice);
        }

        const variant = await prisma.productVariant.create({
            data: {
                productId,
                name,
                barcode,
                price: finalPrice,
                retail: finalRetail == 0 ? finalPrice : finalRetail,
                wholesale: finalWholesale == 0 ? finalPrice : finalWholesale,
                factor: f,
                isDefault: false
            },
        });
        res.status(201).json(variant);
    } catch (error) {
        console.error("Create variant error:", error);
        res.status(500).json({ error: "Failed to create variant — barcode may already exist" });
    }
};

export const updateVariant = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.variantId);
    const { name, barcode, price, retail, wholesale, factor, isDefault } = req.body;
    try {
        if (barcode) {
            const existing = await prisma.productVariant.findFirst({ where: { barcode, NOT: { id } } });
            if (existing) { res.status(409).json({ error: "Barcode already in use" }); return; }
        }

        const variant = await prisma.productVariant.findUnique({ where: { id } });
        if (!variant) { res.status(404).json({ error: "Variant not found" }); return; }

        const isUpdatingDefault = isDefault ?? variant.isDefault;
        const f = factor ?? variant.factor ?? 1;

        let finalPrice = price ?? variant.price;
        let finalRetail = retail === 0 ? finalPrice : (retail ?? variant.retail ?? finalPrice);
        let finalWholesale = wholesale === 0 ? finalPrice : (wholesale ?? variant.wholesale ?? finalPrice);

        if (!isUpdatingDefault) {
            const defaultVariant = await prisma.productVariant.findFirst({
                where: { productId: variant.productId, isDefault: true }
            });
            if (defaultVariant) {
                finalPrice = defaultVariant.price * f;
                finalRetail = (defaultVariant.retail ?? defaultVariant.price) * f;
                finalWholesale = (defaultVariant.wholesale ?? defaultVariant.price) * f;
            }
        }

        const updated = await prisma.productVariant.update({
            where: { id },
            data: {
                name,
                barcode,
                price: finalPrice,
                retail: finalRetail == 0 ? finalPrice : finalRetail,
                wholesale: finalWholesale == 0 ? finalPrice : finalWholesale,
                factor: f,
                isDefault: isUpdatingDefault
            },
        });

        if (updated.isDefault) {
            const otherVariants = await prisma.productVariant.findMany({
                where: { productId: updated.productId, isDefault: false }
            });
            for (const other of otherVariants) {
                await prisma.productVariant.update({
                    where: { id: other.id },
                    data: {
                        price: updated.price * other.factor,
                        retail: (updated.retail ?? updated.price) * other.factor,
                        wholesale: (updated.wholesale ?? updated.price) * other.factor,
                    }
                });
            }
        }

        res.json(updated);
    } catch (error) {
        console.error("Update variant error:", error);
        res.status(500).json({ error: "Failed to update variant" });
    }
};

export const deleteVariant = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.variantId);
    try {
        await prisma.productVariant.delete({ where: { id } });
        res.json({ message: "Variant deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete variant — it may be in use" });
    }
};

// ---- VARIANT LOOKUP BY BARCODE ----

export const getVariantByBarcode = async (req: Request, res: Response): Promise<void> => {
    const { barcode } = req.params;
    try {
        const variant = await prisma.productVariant.findUnique({
            where: { barcode },
            include: { product: { include: { category: true, brand: true, variants: true } } },
        });
        if (!variant) { res.status(404).json({ error: "Variant not found" }); return; }
        res.json(variant);
    } catch {
        res.status(500).json({ error: "Failed to find variant" });
    }
};

export const getProductByBarcode = async (req: Request, res: Response): Promise<void> => {
    const { barcode } = req.params;
    try {
        const product = await prisma.product.findFirst({
            where: { variants: { some: { barcode } } },
            include: { brand: true, category: true, variants: true },
        });
        if (!product) { res.status(404).json({ error: "Product not found" }); return; }
        res.json(product);

    } catch {
        res.status(500).json({ error: "Failed to find product" });
    }
};

// ---- PRODUCT TRANSACTION HISTORY ----

export const getProductHistory = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const product = await prisma.product.findUnique({ where: { id }, select: { id: true, name: true } });
        if (!product) { res.status(404).json({ error: "Product not found" }); return; }

        const variantIds = (await prisma.productVariant.findMany({ where: { productId: id }, select: { id: true } })).map(v => v.id);

        const [recentSales, recentPurchases] = await Promise.all([
            prisma.saleItem.findMany({
                where: { variantId: { in: variantIds } },
                orderBy: { sale: { createdAt: "desc" } },
                take: 20,
                include: {
                    variant: true,
                    sale: { include: { customer: true } },
                },
            }),
            prisma.purchaseItem.findMany({
                where: { productId: id },
                orderBy: { purchase: { createdAt: "desc" } },
                take: 20,
                include: {
                    product: true,
                    purchase: { include: { supplier: true } },
                },
            }),
        ]);

        res.json({ recentSales, recentPurchases });
    } catch {
        res.status(500).json({ error: "Failed to fetch product history" });
    }
};

// ---- IMPORT ----

interface ImportVariant {
    name: string;
    barcode: string;
    price: number;
    factor?: number;
    // discount is intentionally ignored
}

interface ImportProduct {
    name: string;
    barcode?: string;
    description?: string | null;
    brand?: string | null;
    reorderLevel?: number;
    allowNegative?: boolean;
    imageUrl?: string | null;
    avgCost: number;
    stock: number;
    variants?: ImportVariant[];
}

interface ImportCategory {
    name: string;
    description?: string | null;
    subcategories?: ImportCategory[];
    products?: ImportProduct[];
}

interface ImportPayload {
    data: ImportCategory[];
}

interface ImportStats {
    categories: number;
    brands: number;
    products: number;
    variants: number;
}

async function upsertBrand(name: string): Promise<{ id: number; created: boolean }> {
    const existing = await prisma.brand.findUnique({ where: { name } });
    if (existing) return { id: existing.id, created: false };
    const brand = await prisma.brand.create({ data: { name } });
    return { id: brand.id, created: true };
}

async function processCategories(
    categories: ImportCategory[],
    parentId: number | null,
    stats: ImportStats,
    skipped: ImportStats,
    errors: string[]
): Promise<void> {
    for (const cat of categories) {
        let categoryId: number;
        try {
            const existing = await prisma.category.findFirst({
                where: { name: cat.name, parentId: parentId ?? null },
            });
            if (existing) {
                skipped.categories++;
                categoryId = existing.id;
            } else {
                const created = await prisma.category.create({
                    data: { name: cat.name, parentId: parentId ?? undefined },
                });
                stats.categories++;
                categoryId = created.id;
            }
        } catch (err) {
            errors.push(`Category "${cat.name}": ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }

        // Process products in this category
        if (cat.products?.length) {
            for (const prod of cat.products) {
                await processProduct(prod, categoryId, stats, skipped, errors);
            }
        }

        // Recurse into subcategories
        if (cat.subcategories?.length) {
            await processCategories(cat.subcategories, categoryId, stats, skipped, errors);
        }
    }
}

async function processProduct(
    prod: ImportProduct,
    categoryId: number,
    stats: ImportStats,
    skipped: ImportStats,
    errors: string[]
): Promise<void> {
    try {
        // Resolve brand
        let brandId: number | undefined;
        if (prod.brand) {
            try {
                const result = await upsertBrand(prod.brand);
                brandId = result.id;
                if (result.created) stats.brands++;
            } catch {
                // brand upsert failure is non-fatal
            }
        }

        const existingProduct = await prisma.productVariant.findUnique({ where: { barcode: prod.barcode } });

        if (existingProduct) {
            skipped.products++;
            // Still try to add any new variants for the existing product
            if (prod.variants?.length) {
                for (const v of prod.variants) {
                    await processVariant(v, existingProduct.productId, stats, skipped, errors);
                }
            }
            return;
        }

        // Build variants without discount, copying price to retail/wholesale
        const variantData = (prod.variants ?? []).map((v) => ({
            name: v.name,
            barcode: v.barcode,
            price: v.price,
            retail: v.price,
            wholesale: v.price,
            factor: v.factor ?? 1,
            isDefault: v.name.toLowerCase() === "unit" && (v.factor ?? 1) === 1,
        }));

        // If no variant matched the default rule, mark the first one as default
        if (variantData.length > 0 && !variantData.some(v => v.isDefault)) {
            variantData[0].isDefault = true;
        }

        // Apply factor automatically to all non-default variants
        const defaultIndex = variantData.findIndex(v => v.isDefault);
        const defV = defaultIndex !== -1 ? variantData[defaultIndex] : variantData[0];
        if (defV) {
            variantData.forEach((v) => {
                if (v !== defV) {
                    const f = v.factor ?? 1;
                    v.price = defV.price * f;
                    v.retail = defV.price * f;
                    v.wholesale = defV.price * f;
                }
            });
        }

        // Filter out variants with duplicate barcodes before insert
        const safeBarcodes: string[] = [];
        const safeVariants = [];
        for (const v of variantData) {
            if (v.barcode === undefined || v.barcode === null) {
                // default varient get the product barcode and store
                if (prod.barcode) {
                    v.barcode = prod.barcode;
                }
            }
            const barcodeExists = await prisma.productVariant.findUnique({ where: { barcode: v.barcode } });
            if (barcodeExists) {
                skipped.variants++;
            } else if (safeBarcodes.includes(v.barcode)) {
                skipped.variants++;
            } else {
                safeBarcodes.push(v.barcode);
                safeVariants.push(v);
            }
        }
        const lowestPrice = safeVariants.reduce((min, v) => v.price < min ? v.price : min, safeVariants[0]?.price ?? 0);
        await prisma.product.create({
            data: {
                name: prod.name,
                categoryId,
                brandId,
                reorderLevel: prod.reorderLevel ?? 10,
                allowNegative: prod.allowNegative ?? false,
                imageUrl: prod.imageUrl ?? undefined,
                avgCostPrice: prod.avgCost > 0 ? prod.avgCost : (lowestPrice > 0 ? lowestPrice * 0.90 : 0),
                totalStock: prod.stock > 0 ? prod.stock : 0,
                variants: safeVariants.length ? { create: safeVariants } : undefined,
            },
        });

        stats.products++;
        stats.variants += safeVariants.length;
    } catch (err) {
        errors.push(`Product "${prod.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
}

async function processVariant(
    v: ImportVariant,
    productId: number,
    stats: ImportStats,
    skipped: ImportStats,
    errors: string[]
): Promise<void> {
    try {
        const exists = await prisma.productVariant.findUnique({ where: { barcode: v.barcode } });
        if (exists) { skipped.variants++; return; }

        const defaultVariant = await prisma.productVariant.findFirst({
            where: { productId, isDefault: true }
        });
        const f = v.factor ?? 1;
        const finalPrice = defaultVariant ? defaultVariant.price * f : v.price;
        const finalRetail = defaultVariant ? (defaultVariant.retail ?? defaultVariant.price) * f : v.price;
        const finalWholesale = defaultVariant ? (defaultVariant.wholesale ?? defaultVariant.price) * f : v.price;

        await prisma.productVariant.create({
            data: {
                productId,
                name: v.name,
                barcode: v.barcode,
                price: finalPrice,
                retail: finalRetail,
                wholesale: finalWholesale,
                factor: f,
                isDefault: v.name.toLowerCase().includes("unit") && f === 1,
            },
        });
        stats.variants++;
    } catch (err) {
        errors.push(`Variant barcode "${v.barcode}": ${err instanceof Error ? err.message : String(err)}`);
    }
}

async function runImport(payload: ImportPayload): Promise<{ imported: ImportStats; skipped: ImportStats; errors: string[] }> {
    const stats: ImportStats = { categories: 0, brands: 0, products: 0, variants: 0 };
    const skipped: ImportStats = { categories: 0, brands: 0, products: 0, variants: 0 };
    const errors: string[] = [];

    if (!Array.isArray(payload.data)) {
        errors.push('Payload must have a "data" array');
        return { imported: stats, skipped, errors };
    }

    await processCategories(payload.data, null, stats, skipped, errors);

    return { imported: stats, skipped, errors };
}

// POST /products/import  — JSON body
export const importProductsJson = async (req: Request, res: Response): Promise<void> => {
    try {
        const payload = req.body as ImportPayload;
        if (!payload?.data) {
            res.status(400).json({ error: 'Request body must contain a "data" array' });
            return;
        }
        const result = await runImport(payload);
        res.status(200).json(result);
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Import failed" });
    }
};

// POST /products/import/file  — multipart/form-data, field name: "file"
export const importProductsFile = async (req: Request, res: Response): Promise<void> => {
    try {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file) {
            res.status(400).json({ error: 'No file uploaded. Use field name "file" with a JSON file.' });
            return;
        }
        let payload: ImportPayload;
        try {
            payload = JSON.parse(file.buffer.toString("utf-8"));
        } catch {
            res.status(400).json({ error: "Uploaded file is not valid JSON" });
            return;
        }
        if (!payload?.data) {
            res.status(400).json({ error: 'JSON file must contain a "data" array' });
            return;
        }
        const result = await runImport(payload);
        res.status(200).json(result);
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Import failed" });
    }
};
