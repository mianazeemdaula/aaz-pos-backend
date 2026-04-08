import { Router } from "express";
import {
    listSales, getSale, createSale, deleteSale,
} from "../controllers/sales.controller";

const router = Router();

router.get("/", listSales);
router.get("/:id", getSale);
router.post("/", createSale);
router.delete("/:id", deleteSale);

export default router;
