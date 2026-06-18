import { Router } from "express";
import multer from "multer";
import {
    exportProducts, exportBrands, exportCategories, exportCustomers, exportSuppliers,
    importProducts, importBrands, importCategories, importCustomers, importSuppliers,
} from "../controllers/import-export.controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Export endpoints (GET - download CSV)
router.get("/export/products", exportProducts);
router.get("/export/brands", exportBrands);
router.get("/export/categories", exportCategories);
router.get("/export/customers", exportCustomers);
router.get("/export/suppliers", exportSuppliers);

// Import endpoints (POST - upload CSV)
router.post("/import/products", upload.single("file"), importProducts);
router.post("/import/brands", upload.single("file"), importBrands);
router.post("/import/categories", upload.single("file"), importCategories);
router.post("/import/customers", upload.single("file"), importCustomers);
router.post("/import/suppliers", upload.single("file"), importSuppliers);

export default router;
