import { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../../prisma/prisma";
import { generateSignatureSection } from "../../utils/pdf/pdfkit-components";
import {
    fmtDate,
    fmtCurrency,
    pdfConfig,
    generateQRBuffer,
    createPDFGenerator,
    safeAvgCost
} from "./helpers";
import { computeSupplierBalance } from "../../utils/balance";

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

export const getSupplierBusinessReportPDF = async (req: Request, res: Response): Promise<void> => {
    try {
        const supplierId = parseInt(req.params.supplierId);
        if (isNaN(supplierId)) { res.status(400).json({ error: "Invalid supplier ID" }); return; }

        const from = req.query.from ? dayjs(req.query.from as string).startOf("day").toDate() : dayjs().subtract(1, "month").startOf("month").toDate();
        const to = req.query.to ? dayjs(req.query.to as string).endOf("day").toDate() : dayjs().endOf("day").toDate();

        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

        // Fetch all purchases from this supplier in date range
        const purchases = await prisma.purchase.findMany({
            where: { supplierId, date: { gte: from, lte: to } },
            include: { items: { include: { product: true } } },
            orderBy: { date: "desc" },
        });

        // Fetch purchase returns (returns have negative totalAmount)
        const returns = purchases.filter(p => p.totalAmount < 0);
        const regularPurchases = purchases.filter(p => p.totalAmount >= 0);

        // Fetch payments in date range
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

        const qr = await generateQRBuffer(`Supplier Business: ${supplier.name} | ${fmtDate(from)} - ${fmtDate(to)} | Net: ${fmtCurrency(netBusiness)}`);
        const pdfGen = createPDFGenerator(
            pdfConfig(
                "Supplier Business Report",
                `${supplier.name} — ${fmtDate(from)} to ${fmtDate(to)}`,
                {
                    "Supplier": supplier.name,
                    "Phone": supplier.phone ?? "N/A",
                    "Period": `${fmtDate(from)} — ${fmtDate(to)}`,
                },
                "portrait", "A4", qr
            )
        );
        const doc = pdfGen.getDocument();

        // Summary table
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Total Purchases", align: { x: "left", y: "center" } },
            { text: "Total Returns", align: { x: "left", y: "center" } },
            { text: "Net Business", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: `Rs ${fmtCurrency(totalPurchases)}`, align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(totalReturns)}`, align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(netBusiness)}`, align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: "Total Paid (on purchases)", align: { x: "left", y: "center" } },
            { text: "Standalone Payments", align: { x: "left", y: "center" } },
            { text: "Current Balance", align: { x: "left", y: "center" } },
        ]);
        const currentBalance = await computeSupplierBalance(supplierId);

        summaryTable.row([
            { text: `Rs ${fmtCurrency(totalPaid)}`, align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(totalPayments)}`, align: { x: "left", y: "center" } },
            { text: `Rs ${fmtCurrency(currentBalance)}`, align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();
        pdfGen.moveDown(0.5);

        // Purchases table
        if (regularPurchases.length > 0) {
            doc.fontSize(11).font("Helvetica-Bold").fillColor("#1e3a8a").text(`Purchases (${regularPurchases.length})`, doc.page.margins.left);
            doc.moveDown(0.3);
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 60, 75, 75, 75, 75, 60],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#dbeafe", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "PO #", "Date", "Total", "Paid", "Due", "Items"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            regularPurchases.forEach((p, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: p.invoiceNo ?? `PO-${p.id}`, align: { x: "center", y: "center" } },
                    { text: fmtDate(p.date), align: { x: "center", y: "center" } },
                    { text: fmtCurrency(p.totalAmount), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(p.paidAmount), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(Math.max(0, p.totalAmount - p.paidAmount)), align: { x: "right", y: "center" } },
                    { text: String(p.items?.length ?? 0), align: { x: "center", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total", colSpan: 3, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalPurchases), align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalPaid), align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalPurchases - totalPaid), align: { x: "right", y: "center" } },
                { text: String(totalItems), align: { x: "center", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.5);
        }

        // Returns table
        if (returns.length > 0) {
            doc.fontSize(11).font("Helvetica-Bold").fillColor("#9a3412").text(`Returns (${returns.length})`, doc.page.margins.left);
            doc.moveDown(0.3);
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 75, 75, 75, 60],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ffedd5", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Date", "Amount", "Items", "Invoice"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            returns.forEach((r, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(r.date), align: { x: "center", y: "center" } },
                    { text: fmtCurrency(r.totalAmount), align: { x: "right", y: "center" } },
                    { text: String(r.items?.length ?? 0), align: { x: "center", y: "center" } },
                    { text: r.invoiceNo ?? `PRTN-${r.id}`, align: { x: "center", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total Returns", colSpan: 2, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalReturns), align: { x: "right", y: "center" } },
                { text: "", align: { x: "center", y: "center" } },
                { text: "", align: { x: "center", y: "center" } },
            ]);
            t.end();
            pdfGen.moveDown(0.5);
        }

        // Payments table
        if (payments.length > 0) {
            doc.fontSize(11).font("Helvetica-Bold").fillColor("#0f766e").text(`Payments (${payments.length})`, doc.page.margins.left);
            doc.moveDown(0.3);
            doc.x = doc.page.margins.left;
            doc.fontSize(8);
            const t = doc.table({
                columnStyles: [30, 75, "*", 80],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#ccfbf1", fontStyle: "bold", fontSize: 9 } : {},
            });
            t.row(["#", "Date", "Account", "Amount"].map(h => ({ text: h, align: { x: "center", y: "center" } })));
            payments.forEach((p, i) => {
                t.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: fmtDate(p.date), align: { x: "center", y: "center" } },
                    { text: p.account?.name ?? "N/A", align: { x: "left", y: "center" } },
                    { text: fmtCurrency(p.amount), align: { x: "right", y: "center" } },
                ]);
            });
            t.row([
                { text: "Total Payments", colSpan: 3, align: { x: "right", y: "center" } },
                { text: fmtCurrency(totalPayments), align: { x: "right", y: "center" } },
            ]);
            t.end();
        }

        generateSignatureSection(doc, {
            signatures: [
                { label: "Prepared By", name: "_________________", title: "Accountant" },
                { label: "Approved By", name: "_________________", title: "Manager" },
            ],
            spacing: 30,
            lineWidth: 120,
            labelFont: { family: "Helvetica-Bold", size: 8 },
            nameFont: { size: 9 },
        });

        await pdfGen.sendToResponse(res, `supplier-business-${supplier.name.replace(/\s+/g, "-")}-${dayjs(from).format("YYYY-MM-DD")}-${dayjs(to).format("YYYY-MM-DD")}.pdf`);
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
                items: {
                    include: {
                        product: { select: { name: true } }
                    }
                },
            },
        });

        const totalCost = purchases.reduce((s, p) => s + p.totalAmount, 0);
        const totalPaid = purchases.reduce((s, p) => s + p.paidAmount, 0);
        const totalDue = totalCost - totalPaid;
        const totalDiscount = purchases.reduce((s, p) => s + p.discount, 0);
        const totalTax = purchases.reduce((s, p) => s + p.taxAmount, 0);

        const rows = purchases.map((p, i) => {
            const itemLines = p.items.map(item => {
                const name = item.product?.name || "Product";
                return `${name} - ${item.quantity} x ${item.unitCost}`;
            }).join("\n");

            return {
                sno: i + 1,
                date: p.date,
                supplier: p.supplier?.name ?? "N/A",
                invoiceNo: p.invoiceNo ?? `PO-${p.id}`,
                itemDetails: itemLines || "No items",
                discount: p.discount,
                tax: p.taxAmount,
                total: p.totalAmount,
                paid: p.paidAmount,
                due: p.totalAmount - p.paidAmount,
            };
        });

        let supName = "All";
        if (supplierId) {
            const s = await prisma.supplier.findUnique({ where: { id: parseInt(supplierId as string) }, select: { name: true } });
            if (s) supName = s.name;
        }

        const purchQr = await generateQRBuffer(`Detailed Purchases Report | Supplier: ${supName} | Orders: ${purchases.length}`);
        const pdfGen = createPDFGenerator(
            pdfConfig("Detailed Purchases Report", "Detailed Supplier Purchases Summary", {
                "From": from ? fmtDate(from as string) : "All Time",
                "To": to ? fmtDate(to as string) : "Now",
                "Supplier": supName,
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
            columnStyles: [20, 80, 70, 100, 250, 50, 40, 60, 60, 70],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 9, fontStyle: "bold" } : {},
        });
        table.row([
            { text: "#", align: { x: "center", y: "center" } },
            { text: "Date", align: { x: "center", y: "center" } },
            { text: "Invoice No.", align: { x: "center", y: "center" } },
            { text: "Supplier", align: { x: "left", y: "center" } },
            { text: "Item Details (Product - Qty x Cost)", align: { x: "left", y: "center" } },
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
                { text: row.invoiceNo, align: { x: "center", y: "center" } },
                { text: row.supplier, align: { x: "left", y: "center" } },
                { text: row.itemDetails, align: { x: "left", y: "center" } },
                { text: fmtCurrency(row.discount), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.tax), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.total), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.paid), align: { x: "right", y: "center" } },
                { text: fmtCurrency(row.due), align: { x: "right", y: "center" } },
            ]);
        });
        doc.fontSize(8);
        table.row([
            { text: "Grand Total", colSpan: 5, align: { x: "justify", y: "center" } },
            { text: fmtCurrency(totalDiscount), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalTax), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalCost), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalPaid), align: { x: "right", y: "center" } },
            { text: fmtCurrency(totalDue), align: { x: "right", y: "center" } },
        ]);
        table.end();

        await pdfGen.sendToResponse(res, `detailed-purchases-report-${dayjs().format("YYYY-MM-DD")}.pdf`);
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

        if (products.length === 0) {
            const emptyQr = await generateQRBuffer(`PO Rec Report | No Products`);
            const pdfGen = createPDFGenerator(
                pdfConfig(
                    "Purchase Order Recommendation Report",
                    "Supplier & Quantity Recommendations based on Sales Velocity",
                    { "Products": 0 },
                    "landscape",
                    "A4",
                    emptyQr
                )
            );
            const doc = pdfGen.getDocument();
            doc.x = doc.page.margins.left;
            doc.text("No products found matching filters.");
            await pdfGen.sendToResponse(res, `purchase-order-recommendation-${dayjs().format("YYYY-MM-DD")}.pdf`);
            return;
        }

        // 1. Fetch sales quantities of these products in the date range
        const saleItems = await prisma.saleItem.findMany({
            where: {
                sale: {
                    createdAt: {
                        gte: fromDate,
                        lte: toDate,
                    },
                },
                variant: {
                    productId: { in: products.map(p => p.id) }
                }
            },
            select: {
                quantity: true,
                variant: {
                    select: {
                        productId: true,
                        factor: true
                    }
                }
            }
        });

        const salesByProductId: Record<number, number> = {};
        for (const item of saleItems) {
            const prodId = item.variant.productId;
            const baseQty = item.quantity * (item.variant.factor || 1);
            salesByProductId[prodId] = (salesByProductId[prodId] || 0) + baseQty;
        }

        // 2. Fetch historical purchase suppliers for each product (most recent first)
        const purchaseItems = await prisma.purchaseItem.findMany({
            where: {
                productId: { in: products.map(p => p.id) }
            },
            select: {
                productId: true,
                purchase: {
                    select: {
                        date: true,
                        supplier: {
                            select: {
                                id: true,
                                name: true,
                                phone: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                purchase: {
                    date: "desc"
                }
            }
        });

        // Map product ID to their most recent supplier
        const supplierByProductId: Record<number, { id: number; name: string; phone: string | null }> = {};
        for (const item of purchaseItems) {
            const prodId = item.productId;
            if (item.purchase?.supplier && !supplierByProductId[prodId]) {
                supplierByProductId[prodId] = item.purchase.supplier;
            }
        }

        // 3. Category fallback supplier mapping
        const categoryPurchaseItems = await prisma.purchaseItem.findMany({
            where: {
                product: {
                    categoryId: { in: products.map(p => p.categoryId) }
                }
            },
            select: {
                product: { select: { categoryId: true } },
                purchase: {
                    select: {
                        supplier: {
                            select: {
                                id: true,
                                name: true,
                                phone: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                purchase: {
                    date: "desc"
                }
            }
        });

        const categorySuppliers: Record<number, { id: number; name: string; phone: string | null }> = {};
        for (const item of categoryPurchaseItems) {
            const catId = item.product.categoryId;
            const sup = item.purchase.supplier;
            if (sup && !categorySuppliers[catId]) {
                categorySuppliers[catId] = sup;
            }
        }

        // 4. Compute recommendation
        const rows = products.map((product) => {
            const currentStock = product.totalStock;
            const reorderLevel = product.reorderLevel;
            const soldBaseQty = salesByProductId[product.id] || 0;
            const velocity = soldBaseQty / days;
            
            // Forecast is to cover the same length of period (days)
            const forecastDemand = Math.round(velocity * days);
            
            // Need reorder?
            const needsReorder = currentStock <= reorderLevel || currentStock < forecastDemand;
            
            // If needs reorder, build a healthy buffer (max of forecast or double reorder level)
            const targetStock = Math.max(forecastDemand, reorderLevel * 2);
            const recommendedQty = needsReorder ? Math.max(0, targetStock - currentStock) : 0;
            
            const cost = safeAvgCost(product.avgCostPrice, product.variants[0]?.price ?? 0);
            const estCost = recommendedQty * cost;

            // Get supplier
            let recSupplier = supplierByProductId[product.id];
            let supplierType = "Direct";
            if (!recSupplier) {
                recSupplier = categorySuppliers[product.categoryId];
                supplierType = recSupplier ? "Category" : "N/A";
            }

            return {
                id: product.id,
                name: product.name,
                category: product.category.name,
                brand: product.brand?.name ?? "N/A",
                barcode: product.variants[0]?.barcode ?? "—",
                currentStock,
                reorderLevel,
                soldQty: soldBaseQty,
                recommendedQty,
                avgCost: cost,
                estCost,
                supplier: recSupplier ? `${recSupplier.name}${recSupplier.phone ? ` (${recSupplier.phone})` : ""}` : "No History",
                supplierType
            };
        }).filter(row => row.recommendedQty > 0);

        const totalInvestment = rows.reduce((s, r) => s + r.estCost, 0);
        const totalQty = rows.reduce((s, r) => s + r.recommendedQty, 0);

        const meta: Record<string, string | number> = {
            "Products to Reorder": rows.length,
            "Total Qty Recommended": totalQty,
            "Est. Total Cost": fmtCurrency(totalInvestment),
            "Analysis Period": `${fmtDate(fromDate)} to ${fmtDate(toDate)} (${days} days)`,
        };

        if (categoryId) {
            const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } });
            if (cat) meta["Category"] = cat.name;
        }
        if (brandId) {
            const br = await prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } });
            if (br) meta["Brand"] = br.name;
        }

        const reportQr = await generateQRBuffer(`PO Rec Report | Needing Reorder: ${rows.length} | Qty: ${totalQty} | Cost: ${fmtCurrency(totalInvestment)}`);
        
        const pdfGen = createPDFGenerator(
            pdfConfig(
                "Purchase Order Recommendation Report",
                "Supplier & Quantity Recommendations based on Sales Velocity",
                meta,
                "landscape",
                "A4",
                reportQr
            )
        );
        const doc = pdfGen.getDocument();

        // Summary Cards
        doc.x = doc.page.margins.left;
        const summaryTable = doc.table({
            columnStyles: ["*", "*", "*", "*"],
            rowStyles: (row: number) => row === 0 ? { backgroundColor: "#f0f0f0", fontSize: 10, fontStyle: "bold" } : {},
        });
        summaryTable.row([
            { text: "Products to Order", align: { x: "left", y: "center" } },
            { text: "Total Recommended Units", align: { x: "left", y: "center" } },
            { text: "Estimated Investment", align: { x: "left", y: "center" } },
            { text: "Velocity Lookback Period", align: { x: "left", y: "center" } },
        ]);
        summaryTable.row([
            { text: rows.length.toString(), align: { x: "left", y: "center" } },
            { text: totalQty.toString(), align: { x: "left", y: "center" } },
            { text: fmtCurrency(totalInvestment), align: { x: "left", y: "center" } },
            { text: `${days} Days`, align: { x: "left", y: "center" } },
        ]);
        summaryTable.end();

        pdfGen.moveDown(0.5);

        if (rows.length === 0) {
            doc.x = doc.page.margins.left;
            doc.fontSize(10).text("All products have sufficient stock levels based on sales velocity and reorder thresholds.", { align: "center" });
        } else {
            // Recommendations Table
            doc.x = doc.page.margins.left;
            const table = doc.table({
                columnStyles: [20, "*", 70, 65, 70, 35, 40, 35, 40, 50, 60, 120],
                rowStyles: (row: number) => row === 0 ? { backgroundColor: "#1e293b", textColor: "#ffffff", fontSize: 9, fontStyle: "bold" } : {},
            });
            table.row([
                { text: "#", align: { x: "center", y: "center" } },
                { text: "Product Name", align: { x: "left", y: "center" } },
                { text: "Barcode", align: { x: "center", y: "center" } },
                { text: "Brand", align: { x: "left", y: "center" } },
                { text: "Category", align: { x: "left", y: "center" } },
                { text: "Stock", align: { x: "center", y: "center" } },
                { text: "Reorder", align: { x: "center", y: "center" } },
                { text: "Sales", align: { x: "center", y: "center" } },
                { text: "Rec Qty", align: { x: "center", y: "center" } },
                { text: "Avg Cost", align: { x: "right", y: "center" } },
                { text: "Est Cost", align: { x: "right", y: "center" } },
                { text: "Recommended Supplier", align: { x: "left", y: "center" } },
            ]);

            rows.forEach((row, i) => {
                table.row([
                    { text: String(i + 1), align: { x: "center", y: "center" } },
                    { text: row.name, align: { x: "left", y: "center" } },
                    { text: row.barcode, align: { x: "center", y: "center" } },
                    { text: row.brand, align: { x: "left", y: "center" } },
                    { text: row.category, align: { x: "left", y: "center" } },
                    { text: String(row.currentStock), align: { x: "center", y: "center" } },
                    { text: String(row.reorderLevel), align: { x: "center", y: "center" } },
                    { text: String(row.soldQty), align: { x: "center", y: "center" } },
                    { text: String(row.recommendedQty), align: { x: "center", y: "center" } },
                    { text: fmtCurrency(row.avgCost), align: { x: "right", y: "center" } },
                    { text: fmtCurrency(row.estCost), align: { x: "right", y: "center" } },
                    { text: `${row.supplier} [${row.supplierType}]`, align: { x: "left", y: "center" } },
                ]);
            });

            table.row([
                { text: "Grand Total", colSpan: 8, align: { x: "justify", y: "center" } },
                { text: String(totalQty), align: { x: "center", y: "center" } },
                { text: "", align: { x: "center", y: "center" } },
                { text: fmtCurrency(totalInvestment), align: { x: "right", y: "center" } },
                { text: "", align: { x: "center", y: "center" } },
            ]);
            table.end();
        }

        generateSignatureSection(doc, {
            signatures: [
                { label: "Prepared By", name: "_________________", title: "Accountant" },
                { label: "Approved By", name: "_________________", title: "Manager" },
            ],
            spacing: 30,
            lineWidth: 120,
            labelFont: { family: "Helvetica-Bold", size: 8 },
            nameFont: { size: 9 },
        });

        await pdfGen.sendToResponse(res, `purchase-order-recommendation-${dayjs().format("YYYY-MM-DD")}.pdf`);
    } catch (error) {
        console.error("Purchase order recommendation PDF error:", error);
        res.status(500).json({ error: "Failed to generate purchase order recommendation report", message: error instanceof Error ? error.message : "Unknown error" });
    }
};
