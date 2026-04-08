import { Router } from "express";
import { listBrands, getBrand, createBrand, updateBrand, deleteBrand } from "../controllers/brands.controller";

const router = Router();

router.get("/", listBrands);
router.get("/:id", getBrand);
router.post("/", createBrand);
router.put("/:id", updateBrand);
router.delete("/:id", deleteBrand);

export default router;
