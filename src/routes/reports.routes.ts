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
    getCashierSalesReportPDF,
    getCustomerDetailedSalesReportPDF,
    getSupplierDetailedPurchasesReportPDF,
    getPurchaseOrderRecommendationPDF,
    getOverallBusinessReportPDF,
    getOverallPayablesReceivablesReportPDF,
    getCostAboveSalePriceReportPDF,
} from "../controllers/reports.controller";
import { authorize, DASHBOARD_READERS } from "../services/auth";

const router = Router();

// JSON endpoints
// The dashboard tiles belong to the `dashboard` module, not to Reports — a
// cashier with a dashboard may see them without being handed every financial
// report below.
router.get("/dashboard", authorize("reports", { readableBy: DASHBOARD_READERS }), getDashboardStats);

// Everything from here on is the Reports module proper.
router.use(authorize("reports"));

// PDF report endpoints
router.get("/overall-business", getOverallBusinessReportPDF);
router.get("/payables-receivables", getOverallPayablesReceivablesReportPDF);
router.get("/sales", getSalesReportPDF);
router.get("/cashier-sales", getCashierSalesReportPDF);
router.get("/detailed-sales", getCustomerDetailedSalesReportPDF);
router.get("/purchases", getPurchasesReportPDF);
router.get("/detailed-purchases", getSupplierDetailedPurchasesReportPDF);
router.get("/purchase-order-recommendation", getPurchaseOrderRecommendationPDF);
router.get("/inventory", getInventoryReportPDF);
router.get("/cost-above-sale-price", getCostAboveSalePriceReportPDF);
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
