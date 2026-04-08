import { Router } from "express";
import {
    listPurchases, getPurchase, createPurchase, deletePurchase,
} from "../controllers/purchases.controller";

const router = Router();

router.get("/", listPurchases);
router.get("/:id", getPurchase);
router.post("/", createPurchase);
router.delete("/:id", deletePurchase);

export default router;
