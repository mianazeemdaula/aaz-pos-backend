import { Router } from "express";
import {
    listHeldSales, getHeldSale, createHeldSale, resumeHeldSale, cancelHeldSale,
    listHeldPurchases, getHeldPurchase, createHeldPurchase, resumeHeldPurchase, cancelHeldPurchase,
} from "../controllers/held-transactions.controller";

const router = Router();

// Held Sales
router.get("/sales", listHeldSales);
router.get("/sales/:id", getHeldSale);
router.post("/sales", createHeldSale);
router.patch("/sales/:id/resume", resumeHeldSale);
router.patch("/sales/:id/cancel", cancelHeldSale);

// Held Purchases
router.get("/purchases", listHeldPurchases);
router.get("/purchases/:id", getHeldPurchase);
router.post("/purchases", createHeldPurchase);
router.patch("/purchases/:id/resume", resumeHeldPurchase);
router.patch("/purchases/:id/cancel", cancelHeldPurchase);

export default router;
