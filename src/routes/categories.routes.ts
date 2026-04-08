import { Router } from "express";
import { getCategory, createCategory, updateCategory, deleteCategory, treeCategories } from "../controllers/categories.controller";

const router = Router();

router.get("/", treeCategories);
router.get("/:id", getCategory);
router.post("/", createCategory);
router.put("/:id", updateCategory);
router.delete("/:id", deleteCategory);

export default router;
