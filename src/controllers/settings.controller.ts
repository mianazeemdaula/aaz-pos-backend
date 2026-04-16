import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import fs from "fs";
import path from "path";

const SETTINGS_FILE = path.join(process.cwd(), "settings.json");

function readSettings(): Record<string, unknown> {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
        }
    } catch { /* fallback */ }
    return {
        businessName: "AAZ Point of Sale",
        address: "",
        phone: "",
        ntn: "",
        strn: "",
        currency: "PKR",
        defaultTaxRate: 0,
    };
}

function writeSettings(data: Record<string, unknown>) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export const getSettings = (_req: Request, res: Response): void => {
    res.json(readSettings());
};

export const updateSettings = (req: Request, res: Response): void => {
    const current = readSettings();
    const updated = { ...current, ...req.body };
    writeSettings(updated);
    res.json(updated);
};

// ─── App Settings (DB-stored key/value) ──────────────────────────────────────

export const getAppSettings = async (_req: Request, res: Response): Promise<void> => {
    try {
        const settings = await prisma.setting.findMany();
        const map: Record<string, unknown> = {};
        for (const s of settings) {
            if (s.type === "boolean") map[s.key] = s.value === "true";
            else if (s.type === "number") map[s.key] = Number(s.value);
            else if (s.type === "json") { try { map[s.key] = JSON.parse(s.value); } catch { map[s.key] = s.value; } }
            else map[s.key] = s.value;
        }
        res.json(map);
    } catch {
        res.status(500).json({ error: "Failed to fetch app settings" });
    }
};

export const updateAppSettings = async (req: Request, res: Response): Promise<void> => {
    const entries = req.body as Record<string, unknown>;
    if (!entries || typeof entries !== "object") {
        res.status(400).json({ error: "Body must be an object of key-value pairs" });
        return;
    }
    try {
        for (const [key, value] of Object.entries(entries)) {
            const strValue = String(value);
            const type = typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string";
            await prisma.setting.upsert({
                where: { key },
                create: { key, value: strValue, type },
                update: { value: strValue, type },
            });
        }
        // Return all settings after update
        const settings = await prisma.setting.findMany();
        const map: Record<string, unknown> = {};
        for (const s of settings) {
            if (s.type === "boolean") map[s.key] = s.value === "true";
            else if (s.type === "number") map[s.key] = Number(s.value);
            else map[s.key] = s.value;
        }
        res.json(map);
    } catch {
        res.status(500).json({ error: "Failed to update app settings" });
    }
};

// ─── Per-User Settings ───────────────────────────────────────────────────────

export const getUserSettings = async (req: Request, res: Response): Promise<void> => {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
    try {
        const prefix = `user.${userId}.`;
        const settings = await prisma.setting.findMany({ where: { key: { startsWith: prefix } } });
        const map: Record<string, unknown> = {};
        for (const s of settings) {
            const shortKey = s.key.replace(prefix, "");
            if (s.type === "boolean") map[shortKey] = s.value === "true";
            else if (s.type === "number") map[shortKey] = Number(s.value);
            else map[shortKey] = s.value;
        }
        res.json(map);
    } catch {
        res.status(500).json({ error: "Failed to fetch user settings" });
    }
};

export const updateUserSettings = async (req: Request, res: Response): Promise<void> => {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
    const entries = req.body as Record<string, unknown>;
    if (!entries || typeof entries !== "object") {
        res.status(400).json({ error: "Body must be an object of key-value pairs" });
        return;
    }
    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) { res.status(404).json({ error: "User not found" }); return; }
        const prefix = `user.${userId}.`;
        for (const [key, value] of Object.entries(entries)) {
            const fullKey = `${prefix}${key}`;
            const strValue = String(value);
            const type = typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string";
            await prisma.setting.upsert({
                where: { key: fullKey },
                create: { key: fullKey, value: strValue, type },
                update: { value: strValue, type },
            });
        }
        // Return updated user settings
        const settings = await prisma.setting.findMany({ where: { key: { startsWith: prefix } } });
        const map: Record<string, unknown> = {};
        for (const s of settings) {
            const shortKey = s.key.replace(prefix, "");
            if (s.type === "boolean") map[shortKey] = s.value === "true";
            else map[shortKey] = s.value;
        }
        res.json(map);
    } catch {
        res.status(500).json({ error: "Failed to update user settings" });
    }
};

// ─── All Users Settings (bulk) ───────────────────────────────────────────────

export const getAllUsersSettings = async (_req: Request, res: Response): Promise<void> => {
    try {
        const settings = await prisma.setting.findMany({ where: { key: { startsWith: "user." } } });
        const result: Record<number, Record<string, unknown>> = {};
        for (const s of settings) {
            const match = s.key.match(/^user\.(\d+)\.(.+)$/);
            if (!match) continue;
            const uid = parseInt(match[1]);
            const shortKey = match[2];
            if (!result[uid]) result[uid] = {};
            if (s.type === "boolean") result[uid][shortKey] = s.value === "true";
            else if (s.type === "number") result[uid][shortKey] = Number(s.value);
            else result[uid][shortKey] = s.value;
        }
        res.json(result);
    } catch {
        res.status(500).json({ error: "Failed to fetch users settings" });
    }
};

// ─── Backup ──────────────────────────────────────────────────────────────────

export const backupDatabase = async (_req: Request, res: Response): Promise<void> => {
    try {
        const [
            users, accounts, customers, customerLedger, customerPayments,
            suppliers, supplierLedger, supplierPayments,
            categories, brands, products, productVariants,
            sales, saleItems, salePayments,
            purchases, purchaseItems, purchasePayments,
            employees, employeeLedger, salarySlips, employeeAdvances,
            expenses, stockMovements, heldSales, heldPurchases,
            packages, packageItems, promotions, promotionItems,
            advanceBookings, advanceBookingItems,
        ] = await Promise.all([
            prisma.user.findMany(),
            prisma.account.findMany(),
            prisma.customer.findMany(),
            prisma.customerLedger.findMany(),
            prisma.customerPayment.findMany(),
            prisma.supplier.findMany(),
            prisma.supplierLedger.findMany(),
            prisma.supplierPayment.findMany(),
            prisma.category.findMany(),
            prisma.brand.findMany(),
            prisma.product.findMany(),
            prisma.productVariant.findMany(),
            prisma.sale.findMany(),
            prisma.saleItem.findMany(),
            prisma.salePayment.findMany(),
            prisma.purchase.findMany(),
            prisma.purchaseItem.findMany(),
            prisma.purchasePayment.findMany(),
            prisma.employee.findMany(),
            prisma.employeeLedger.findMany(),
            prisma.salarySlip.findMany(),
            prisma.employeeAdvance.findMany(),
            prisma.expense.findMany(),
            prisma.stockMovement.findMany(),
            prisma.heldSale.findMany(),
            prisma.heldPurchase.findMany(),
            prisma.package.findMany(),
            prisma.packageItem.findMany(),
            prisma.promotion.findMany(),
            prisma.promotionItems.findMany(),
            prisma.advanceBooking.findMany(),
            prisma.advanceBookingItems.findMany(),
        ]);

        const backup = {
            version: 1,
            exportedAt: new Date().toISOString(),
            settings: readSettings(),
            data: {
                users, accounts, customers, customerLedger, customerPayments,
                suppliers, supplierLedger, supplierPayments,
                categories, brands, products, productVariants,
                sales, saleItems, salePayments,
                purchases, purchaseItems, purchasePayments,
                employees, employeeLedger, salarySlips, employeeAdvances,
                expenses, stockMovements, heldSales, heldPurchases,
                packages, packageItems, promotions, promotionItems,
                advanceBookings, advanceBookingItems,
            },
        };

        const filename = `pos-backup-${new Date().toISOString().slice(0, 10)}.json`;
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "application/json");
        res.json(backup);
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : "Backup failed" });
    }
};

// ─── Restore ─────────────────────────────────────────────────────────────────

export const restoreDatabase = async (req: Request, res: Response): Promise<void> => {
    const backup = req.body as {
        version?: number;
        settings?: Record<string, unknown>;
        data?: Record<string, unknown[]>;
    };

    if (!backup?.data) {
        res.status(400).json({ error: "Invalid backup file — missing data" });
        return;
    }

    try {
        // Restore settings file
        if (backup.settings) {
            writeSettings(backup.settings);
        }

        const d = backup.data;

        // Wipe and restore inside a transaction
        await prisma.$transaction(async (tx) => {
            // Delete in reverse dependency order
            await tx.advanceBookingItems.deleteMany();
            await tx.advanceBooking.deleteMany();
            await tx.promotionItems.deleteMany();
            await tx.promotion.deleteMany();
            await tx.packageItem.deleteMany();
            await tx.package.deleteMany();
            await tx.heldPurchase.deleteMany();
            await tx.heldSale.deleteMany();
            await tx.stockMovement.deleteMany();
            await tx.expense.deleteMany();
            await tx.employeeAdvance.deleteMany();
            await tx.salarySlip.deleteMany();
            await tx.employeeLedger.deleteMany();
            await tx.employee.deleteMany();
            await tx.purchasePayment.deleteMany();
            await tx.purchaseItem.deleteMany();
            await tx.purchase.deleteMany();
            await tx.salePayment.deleteMany();
            await tx.saleItem.deleteMany();
            await tx.sale.deleteMany();
            await tx.productVariant.deleteMany();
            await tx.product.deleteMany();
            await tx.brand.deleteMany();
            await tx.category.deleteMany();
            await tx.supplierPayment.deleteMany();
            await tx.supplierLedger.deleteMany();
            await tx.supplier.deleteMany();
            await tx.customerPayment.deleteMany();
            await tx.customerLedger.deleteMany();
            await tx.customer.deleteMany();
            await tx.account.deleteMany();
            await tx.user.deleteMany();

            // Re-insert in dependency order
            if (d.users?.length) await tx.user.createMany({ data: d.users as any[], skipDuplicates: true });
            if (d.accounts?.length) await tx.account.createMany({ data: d.accounts as any[], skipDuplicates: true });
            if (d.customers?.length) await tx.customer.createMany({ data: d.customers as any[], skipDuplicates: true });
            if (d.customerLedger?.length) await tx.customerLedger.createMany({ data: d.customerLedger as any[], skipDuplicates: true });
            if (d.customerPayments?.length) await tx.customerPayment.createMany({ data: d.customerPayments as any[], skipDuplicates: true });
            if (d.suppliers?.length) await tx.supplier.createMany({ data: d.suppliers as any[], skipDuplicates: true });
            if (d.supplierLedger?.length) await tx.supplierLedger.createMany({ data: d.supplierLedger as any[], skipDuplicates: true });
            if (d.supplierPayments?.length) await tx.supplierPayment.createMany({ data: d.supplierPayments as any[], skipDuplicates: true });
            if (d.categories?.length) await tx.category.createMany({ data: d.categories as any[], skipDuplicates: true });
            if (d.brands?.length) await tx.brand.createMany({ data: d.brands as any[], skipDuplicates: true });
            if (d.products?.length) await tx.product.createMany({ data: d.products as any[], skipDuplicates: true });
            if (d.productVariants?.length) await tx.productVariant.createMany({ data: d.productVariants as any[], skipDuplicates: true });
            if (d.sales?.length) await tx.sale.createMany({ data: d.sales as any[], skipDuplicates: true });
            if (d.saleItems?.length) await tx.saleItem.createMany({ data: d.saleItems as any[], skipDuplicates: true });
            if (d.salePayments?.length) await tx.salePayment.createMany({ data: d.salePayments as any[], skipDuplicates: true });
            if (d.purchases?.length) await tx.purchase.createMany({ data: d.purchases as any[], skipDuplicates: true });
            if (d.purchaseItems?.length) await tx.purchaseItem.createMany({ data: d.purchaseItems as any[], skipDuplicates: true });
            if (d.purchasePayments?.length) await tx.purchasePayment.createMany({ data: d.purchasePayments as any[], skipDuplicates: true });
            if (d.employees?.length) await tx.employee.createMany({ data: d.employees as any[], skipDuplicates: true });
            if (d.employeeLedger?.length) await tx.employeeLedger.createMany({ data: d.employeeLedger as any[], skipDuplicates: true });
            if (d.salarySlips?.length) await tx.salarySlip.createMany({ data: d.salarySlips as any[], skipDuplicates: true });
            if (d.employeeAdvances?.length) await tx.employeeAdvance.createMany({ data: d.employeeAdvances as any[], skipDuplicates: true });
            if (d.expenses?.length) await tx.expense.createMany({ data: d.expenses as any[], skipDuplicates: true });
            if (d.stockMovements?.length) await tx.stockMovement.createMany({ data: d.stockMovements as any[], skipDuplicates: true });
            if (d.heldSales?.length) await tx.heldSale.createMany({ data: d.heldSales as any[], skipDuplicates: true });
            if (d.heldPurchases?.length) await tx.heldPurchase.createMany({ data: d.heldPurchases as any[], skipDuplicates: true });
            if (d.packages?.length) await tx.package.createMany({ data: d.packages as any[], skipDuplicates: true });
            if (d.packageItems?.length) await tx.packageItem.createMany({ data: d.packageItems as any[], skipDuplicates: true });
            if (d.promotions?.length) await tx.promotion.createMany({ data: d.promotions as any[], skipDuplicates: true });
            if (d.promotionItems?.length) await tx.promotionItems.createMany({ data: d.promotionItems as any[], skipDuplicates: true });
            if (d.advanceBookings?.length) await tx.advanceBooking.createMany({ data: d.advanceBookings as any[], skipDuplicates: true });
            if (d.advanceBookingItems?.length) await tx.advanceBookingItems.createMany({ data: d.advanceBookingItems as any[], skipDuplicates: true });
        }, { timeout: 120000 });

        res.json({ message: "Database restored successfully" });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : "Restore failed" });
    }
};
