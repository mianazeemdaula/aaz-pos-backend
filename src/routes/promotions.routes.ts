import { Router } from "express";
import {
    listPromotions, getPromotion, createPromotion, updatePromotion, deletePromotion, getActivePromotions,
} from "../controllers/promotions.controller";

const router = Router();

router.get("/active", getActivePromotions);
router.get("/", listPromotions);
router.get("/:id", getPromotion);
router.post("/", createPromotion);
router.put("/:id", updatePromotion);
router.delete("/:id", deletePromotion);

export default router;
