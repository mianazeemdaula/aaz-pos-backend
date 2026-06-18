import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";

// ── CSV Helpers ──────────────────────────────────────────────────────────────

function escapeCSV(val: unknown): string {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function toCSV(headers: string[], rows: unknown[][]): string {
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(row.map(escapeCSV).join(','));
    }
    return lines.join('\r\n');
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return { headers: [], rows: [] };

    const parseLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"' && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else if (ch === '"') {
                    inQuotes = false;
                } else {
                    current += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    result.push(current.trim());
                    current = '';
                } else {
                    current += ch;
                }
            }
        }
        result.push(current.trim());
        return result;
    };

    const headers = parseLine(lines[0]).map(h => h.toLowerCase().trim());
    const rows = lines.slice(1).map(parseLine);
    return { headers, rows };
}

function getCol(headers: string[], row: string[], name: string): string {
    const idx = headers.indexOf(name.toLowerCase());
    return idx >= 0 && idx < row.length ? row[idx] : '';
}

function sendCSV(res: Response, name: string, csv: string): void {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
}

// ── EXPORT Functions ─────────────────────────────────────────────────────────

export const exportProducts = async (_req: Request, res: Response): Promise<void> => {
    try {
        const products = await prisma.product.findMany({
            include: {
                brand: true,
                category: true,
                variants: true,
            },
            orderBy: { name: "asc" },
        });

        const headers = [
            'name', 'brandName', 'categoryName', 'reorderLevel', 'totalStock',
            'avgCostPrice', 'allowNegative', 'taxRate', 'taxMethod', 'active',
            'isService', 'showBarcodePrice', 'isFavorite', 'saleBelowCost',
            'variantName', 'barcode', 'price', 'retail', 'wholesale', 'factor', 'isDefault',
        ];

        const rows: unknown[][] = [];
        for (const p of products) {
            if (p.variants.length === 0) {
                rows.push([
                    p.name, p.brand?.name ?? '', p.category?.name ?? '', p.reorderLevel,
                    p.totalStock, p.avgCostPrice, p.allowNegative, p.taxRate, p.taxMethod,
                    p.active, p.isService, p.showBarcodePrice, p.isFavorite, p.saleBelowCost,
                    '', '', '', '', '', '', '',
                ]);
            } else {
                for (const v of p.variants) {
                    rows.push([
                        p.name, p.brand?.name ?? '', p.category?.name ?? '', p.reorderLevel,
                        p.totalStock, p.avgCostPrice, p.allowNegative, p.taxRate, p.taxMethod,
                        p.active, p.isService, p.showBarcodePrice, p.isFavorite, p.saleBelowCost,
                        v.name, v.barcode, v.price, v.retail, v.wholesale, v.factor, v.isDefault,
                    ]);
                }
            }
        }

        sendCSV(res, 'products', toCSV(headers, rows));
    } catch {
        res.status(500).json({ error: "Failed to export products" });
    }
};

export const exportBrands = async (_req: Request, res: Response): Promise<void> => {
    try {
        const brands = await prisma.brand.findMany({ orderBy: { name: "asc" } });
        const headers = ['name', 'active'];
        const rows = brands.map(b => [b.name, b.active]);
        sendCSV(res, 'brands', toCSV(headers, rows));
    } catch {
        res.status(500).json({ error: "Failed to export brands" });
    }
};

export const exportCategories = async (_req: Request, res: Response): Promise<void> => {
    try {
        const categories = await prisma.category.findMany({
            orderBy: { name: "asc" },
        });

        const categoryMap = new Map(categories.map(c => [c.id, c.name]));
        const headers = ['name', 'parentName'];
        const rows = categories.map(c => [c.name, c.parentId ? categoryMap.get(c.parentId) ?? '' : '']);
        sendCSV(res, 'categories', toCSV(headers, rows));
    } catch {
        res.status(500).json({ error: "Failed to export categories" });
    }
};

export const exportCustomers = async (_req: Request, res: Response): Promise<void> => {
    try {
        const customers = await prisma.customer.findMany({ orderBy: { name: "asc" } });
        const headers = ['name', 'phone', 'address', 'email', 'balance', 'creditLimit', 'active'];
        const rows = customers.map(c => [c.name, c.phone, c.address, c.email, c.balance, c.creditLimit, c.active]);
        sendCSV(res, 'customers', toCSV(headers, rows));
    } catch {
        res.status(500).json({ error: "Failed to export customers" });
    }
};

export const exportSuppliers = async (_req: Request, res: Response): Promise<void> => {
    try {
        const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
        const headers = ['name', 'phone', 'address', 'email', 'balance', 'bankDetails', 'paymentTerms', 'taxId', 'active'];
        const rows = suppliers.map(s => [s.name, s.phone, s.address, s.email, s.balance, s.bankDetails, s.paymentTerms, s.taxId, s.active]);
        sendCSV(res, 'suppliers', toCSV(headers, rows));
    } catch {
        res.status(500).json({ error: "Failed to export suppliers" });
    }
};

// ── IMPORT Functions ─────────────────────────────────────────────────────────

export const importProducts = async (req: Request, res: Response): Promise<void> => {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

    try {
        const text = req.file.buffer.toString('utf-8');
        const { headers, rows } = parseCSV(text);
        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (let i = 0; i < rows.length; i++) {
            try {
                const row = rows[i];
                const name = getCol(headers, row, 'name');
                const brandName = getCol(headers, row, 'brandname');
                const categoryName = getCol(headers, row, 'categoryname');
                const barcode = getCol(headers, row, 'barcode');
                const variantName = getCol(headers, row, 'variantname');

                if (!name) { errors.push(`Row ${i + 2}: missing product name`); continue; }
                if (!categoryName) { errors.push(`Row ${i + 2}: missing category name`); continue; }

                // Check if product+barcode already exists
                if (barcode) {
                    const existingVariant = await prisma.productVariant.findUnique({ where: { barcode } });
                    if (existingVariant) {
                        const existingProduct = await prisma.product.findUnique({ where: { id: existingVariant.productId } });
                        if (existingProduct && existingProduct.name === name) {
                            skipped++;
                            continue;
                        }
                    }
                }

                // Find or create brand
                let brandId: number | null = null;
                if (brandName) {
                    let brand = await prisma.brand.findUnique({ where: { name: brandName } });
                    if (!brand) {
                        brand = await prisma.brand.create({ data: { name: brandName } });
                    }
                    brandId = brand.id;
                }

                // Find or create category
                let category = await prisma.category.findFirst({ where: { name: categoryName, parentId: null } });
                if (!category) {
                    category = await prisma.category.create({ data: { name: categoryName } });
                }

                // Find or create product
                let product = await prisma.product.findFirst({ where: { name, categoryId: category.id } });
                if (!product) {
                    product = await prisma.product.create({
                        data: {
                            name,
                            brandId,
                            categoryId: category.id,
                            reorderLevel: parseInt(getCol(headers, row, 'reorderlevel')) || 10,
                            totalStock: parseInt(getCol(headers, row, 'totalstock')) || 0,
                            avgCostPrice: parseFloat(getCol(headers, row, 'avgcostprice')) || 0,
                            allowNegative: getCol(headers, row, 'allownegative').toLowerCase() === 'true',
                            taxRate: parseFloat(getCol(headers, row, 'taxrate')) || 0,
                            taxMethod: (getCol(headers, row, 'taxmethod') as any) || 'EXCLUSIVE',
                            active: getCol(headers, row, 'active') ? getCol(headers, row, 'active').toLowerCase() !== 'false' : true,
                            isService: getCol(headers, row, 'isservice').toLowerCase() === 'true',
                            showBarcodePrice: getCol(headers, row, 'showbarcodeprice') ? getCol(headers, row, 'showbarcodeprice').toLowerCase() !== 'false' : true,
                            isFavorite: getCol(headers, row, 'isfavorite').toLowerCase() === 'true',
                            saleBelowCost: getCol(headers, row, 'salebelowcost').toLowerCase() === 'true',
                        },
                    });
                }

                // Create variant if barcode is provided
                if (barcode) {
                    await prisma.productVariant.create({
                        data: {
                            productId: product.id,
                            name: variantName || 'Default',
                            barcode,
                            price: parseFloat(getCol(headers, row, 'price')) || 0,
                            retail: parseFloat(getCol(headers, row, 'retail')) || null,
                            wholesale: parseFloat(getCol(headers, row, 'wholesale')) || null,
                            factor: parseInt(getCol(headers, row, 'factor')) || 1,
                            isDefault: getCol(headers, row, 'isdefault').toLowerCase() === 'true',
                        },
                    });
                }

                imported++;
            } catch (err: any) {
                errors.push(`Row ${i + 2}: ${err.message || 'Unknown error'}`);
            }
        }

        res.json({ imported, skipped, errors });
    } catch {
        res.status(500).json({ error: "Failed to import products" });
    }
};

export const importBrands = async (req: Request, res: Response): Promise<void> => {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

    try {
        const text = req.file.buffer.toString('utf-8');
        const { headers, rows } = parseCSV(text);
        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (let i = 0; i < rows.length; i++) {
            try {
                const row = rows[i];
                const name = getCol(headers, row, 'name');
                if (!name) { errors.push(`Row ${i + 2}: missing brand name`); continue; }

                const existing = await prisma.brand.findUnique({ where: { name } });
                if (existing) { skipped++; continue; }

                await prisma.brand.create({
                    data: {
                        name,
                        active: getCol(headers, row, 'active') ? getCol(headers, row, 'active').toLowerCase() !== 'false' : true,
                    },
                });
                imported++;
            } catch (err: any) {
                errors.push(`Row ${i + 2}: ${err.message || 'Unknown error'}`);
            }
        }

        res.json({ imported, skipped, errors });
    } catch {
        res.status(500).json({ error: "Failed to import brands" });
    }
};

export const importCategories = async (req: Request, res: Response): Promise<void> => {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

    try {
        const text = req.file.buffer.toString('utf-8');
        const { headers, rows } = parseCSV(text);
        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (let i = 0; i < rows.length; i++) {
            try {
                const row = rows[i];
                const name = getCol(headers, row, 'name');
                const parentName = getCol(headers, row, 'parentname');
                if (!name) { errors.push(`Row ${i + 2}: missing category name`); continue; }

                let parentId: number | null = null;
                if (parentName) {
                    const parent = await prisma.category.findFirst({ where: { name: parentName } });
                    if (!parent) { errors.push(`Row ${i + 2}: parent category "${parentName}" not found`); continue; }
                    parentId = parent.id;
                }

                const existing = await prisma.category.findFirst({ where: { name, parentId } });
                if (existing) { skipped++; continue; }

                await prisma.category.create({ data: { name, parentId } });
                imported++;
            } catch (err: any) {
                errors.push(`Row ${i + 2}: ${err.message || 'Unknown error'}`);
            }
        }

        res.json({ imported, skipped, errors });
    } catch {
        res.status(500).json({ error: "Failed to import categories" });
    }
};

export const importCustomers = async (req: Request, res: Response): Promise<void> => {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

    try {
        const text = req.file.buffer.toString('utf-8');
        const { headers, rows } = parseCSV(text);
        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (let i = 0; i < rows.length; i++) {
            try {
                const row = rows[i];
                const name = getCol(headers, row, 'name');
                const phone = getCol(headers, row, 'phone') || null;
                if (!name) { errors.push(`Row ${i + 2}: missing customer name`); continue; }

                const existing = await prisma.customer.findFirst({ where: { name, phone } });
                if (existing) { skipped++; continue; }

                await prisma.customer.create({
                    data: {
                        name,
                        phone,
                        address: getCol(headers, row, 'address') || null,
                        email: getCol(headers, row, 'email') || null,
                        balance: parseFloat(getCol(headers, row, 'balance')) || 0,
                        creditLimit: parseFloat(getCol(headers, row, 'creditlimit')) || null,
                        active: getCol(headers, row, 'active') ? getCol(headers, row, 'active').toLowerCase() !== 'false' : true,
                    },
                });
                imported++;
            } catch (err: any) {
                errors.push(`Row ${i + 2}: ${err.message || 'Unknown error'}`);
            }
        }

        res.json({ imported, skipped, errors });
    } catch {
        res.status(500).json({ error: "Failed to import customers" });
    }
};

export const importSuppliers = async (req: Request, res: Response): Promise<void> => {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

    try {
        const text = req.file.buffer.toString('utf-8');
        const { headers, rows } = parseCSV(text);
        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (let i = 0; i < rows.length; i++) {
            try {
                const row = rows[i];
                const name = getCol(headers, row, 'name');
                const phone = getCol(headers, row, 'phone') || null;
                if (!name) { errors.push(`Row ${i + 2}: missing supplier name`); continue; }

                const existing = await prisma.supplier.findFirst({ where: { name, phone } });
                if (existing) { skipped++; continue; }

                await prisma.supplier.create({
                    data: {
                        name,
                        phone,
                        address: getCol(headers, row, 'address') || null,
                        email: getCol(headers, row, 'email') || null,
                        balance: parseFloat(getCol(headers, row, 'balance')) || 0,
                        bankDetails: getCol(headers, row, 'bankdetails') || null,
                        paymentTerms: getCol(headers, row, 'paymentterms') || null,
                        taxId: getCol(headers, row, 'taxid') || null,
                        active: getCol(headers, row, 'active') ? getCol(headers, row, 'active').toLowerCase() !== 'false' : true,
                    },
                });
                imported++;
            } catch (err: any) {
                errors.push(`Row ${i + 2}: ${err.message || 'Unknown error'}`);
            }
        }

        res.json({ imported, skipped, errors });
    } catch {
        res.status(500).json({ error: "Failed to import suppliers" });
    }
};
