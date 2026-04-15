import { Router } from "express";
import {
    listSales, getSale, createSale, deleteSale, updateSaleTaxInvoice,
} from "../controllers/sales.controller";

const router = Router();

router.get("/", listSales);
router.get("/:id", getSale);
router.post("/", createSale);
router.patch("/:id/tax-invoice", updateSaleTaxInvoice);
router.delete("/:id", deleteSale);

export default router;
