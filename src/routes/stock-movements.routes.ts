import { Router } from "express";
import { listStockMovements, createStockAdjustment } from "../controllers/stock-movements.controller";

const router = Router();

router.get("/", listStockMovements);
router.post("/adjustment", createStockAdjustment);

export default router;
