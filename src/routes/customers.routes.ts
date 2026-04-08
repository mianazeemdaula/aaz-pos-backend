import { Router } from "express";
import {
    listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer,
    listCustomerLedger, createCustomerLedgerEntry,
    listCustomerPayments, createCustomerPayment,
} from "../controllers/customers.controller";

const router = Router();

router.get("/", listCustomers);
router.get("/:id", getCustomer);
router.post("/", createCustomer);
router.put("/:id", updateCustomer);
router.delete("/:id", deleteCustomer);

// Ledger
router.get("/:id/ledger", listCustomerLedger);
router.post("/:id/ledger", createCustomerLedgerEntry);

// Payments
router.get("/:id/payments", listCustomerPayments);
router.post("/:id/payments", createCustomerPayment);

export default router;
