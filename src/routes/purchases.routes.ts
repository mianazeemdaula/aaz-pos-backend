import { Router } from "express";
import {
    listPurchases, getPurchase, createPurchase, updatePurchase, deletePurchase,
} from "../controllers/purchases.controller";

const router = Router();

router.get("/", listPurchases);
router.get("/:id", getPurchase);
router.post("/", createPurchase);
router.put("/:id", updatePurchase);
router.delete("/:id", deletePurchase);

export default router;
