import { Router } from "express";
import {
    listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier,
    listSupplierLedger, createSupplierLedgerEntry,
    listSupplierPayments, createSupplierPayment,
} from "../controllers/suppliers.controller";

const router = Router();

router.get("/", listSuppliers);
router.get("/:id", getSupplier);
router.post("/", createSupplier);
router.put("/:id", updateSupplier);
router.delete("/:id", deleteSupplier);

// Ledger
router.get("/:id/ledger", listSupplierLedger);
router.post("/:id/ledger", createSupplierLedgerEntry);

// Payments
router.get("/:id/payments", listSupplierPayments);
router.post("/:id/payments", createSupplierPayment);

export default router;
