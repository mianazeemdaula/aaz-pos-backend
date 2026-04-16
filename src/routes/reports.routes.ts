import { Router } from "express";
import {
    getDashboardStats,
    getSalesReportPDF,
    getPurchasesReportPDF,
    getInventoryReportPDF,
    getExpensesReportPDF,
    getCustomerBalancesReportPDF,
    getSupplierBalancesReportPDF,
    getCustomerStatementPDF,
    getSupplierStatementPDF,
    getCustomerLedgerReportPDF,
    getSupplierLedgerReportPDF,
    getAccountStatementPDF,
    getStockReportPDF,
    getDailyReportPDF,
    getSupplierBusinessReportPDF,
} from "../controllers/reports.controller";

const router = Router();

// JSON endpoints
router.get("/dashboard", getDashboardStats);
// PDF report endpoints
router.get("/sales", getSalesReportPDF);
router.get("/purchases", getPurchasesReportPDF);
router.get("/inventory", getInventoryReportPDF);
router.get("/expenses", getExpensesReportPDF);
router.get("/customer-balances", getCustomerBalancesReportPDF);
router.get("/supplier-balances", getSupplierBalancesReportPDF);
router.get("/customer-statement/:customerId", getCustomerStatementPDF);
router.get("/supplier-statement/:supplierId", getSupplierStatementPDF);
router.get("/customer-ledger/:customerId", getCustomerLedgerReportPDF);
router.get("/supplier-ledger/:supplierId", getSupplierLedgerReportPDF);
router.get("/account-statement/:accountId", getAccountStatementPDF);
router.get("/stock", getStockReportPDF);
router.get("/daily", getDailyReportPDF);
router.get("/supplier-business/:supplierId", getSupplierBusinessReportPDF);

export default router;
