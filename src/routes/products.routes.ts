import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
    listProducts, getProduct, createProduct, updateProduct, deleteProduct,
    listVariants, getVariant, createVariant, updateVariant, deleteVariant,
    getVariantByBarcode,
    getProductByBarcode,
    getProductHistory,
    importProductsJson,
    importProductsFile,
} from "../controllers/products.controller";

const router = Router();

// Memory storage — file bytes available in req.file.buffer
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Disk storage for product images
const uploadsDir = path.join(process.cwd(), "uploads", "products");
fs.mkdirSync(uploadsDir, { recursive: true });

const imageStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
});

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const imageUpload = multer({
    storage: imageStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only JPEG, PNG, GIF, and WebP images are allowed'));
    },
});

// Image upload endpoint
router.post("/upload-image", imageUpload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: { message: "No image file provided" } });
    const imageUrl = `/uploads/products/${req.file.filename}`;
    res.json({ imageUrl });
});

// Import endpoints (before /:id to avoid route conflicts)
router.post("/import/file", upload.single("file"), importProductsFile);
router.post("/import", importProductsJson);

// Barcode lookup (before /:id to avoid conflict)
router.get("/variants/barcode/:barcode", getVariantByBarcode);
router.get("/barcode/:barcode", getProductByBarcode);

router.get("/", listProducts);
router.get("/:id", getProduct);
router.get("/:id/history", getProductHistory);
router.post("/", createProduct);
router.put("/:id", updateProduct);
router.delete("/:id", deleteProduct);

// Variants nested under product
router.get("/:id/variants", listVariants);
router.get("/:id/variants/:variantId", getVariant);
router.post("/:id/variants", createVariant);
router.put("/:id/variants/:variantId", updateVariant);
router.delete("/:id/variants/:variantId", deleteVariant);

export default router;
