import { Router } from "express";
import { listPackages, getPackage, createPackage, updatePackage, deletePackage, addPackageItem, removePackageItem } from "../controllers/packages.controller";

const router = Router();

router.get("/", listPackages);
router.get("/:id", getPackage);
router.post("/", createPackage);
router.put("/:id", updatePackage);
router.delete("/:id", deletePackage);

// Package items
router.post("/:id/items", addPackageItem);
router.delete("/:id/items/:itemId", removePackageItem);

export default router;
