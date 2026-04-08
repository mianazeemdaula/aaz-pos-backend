import { Router } from "express";
import {
    listSalarySlips, getSalarySlip,
    generateSalarySlip, approveSalarySlip, paySalarySlip, cancelSalarySlip,
} from "../controllers/salary-slips.controller";

const router = Router();

router.get("/", listSalarySlips);
router.get("/:id", getSalarySlip);
router.post("/", generateSalarySlip);
router.patch("/:id/approve", approveSalarySlip);
router.patch("/:id/pay", paySalarySlip);
router.patch("/:id/cancel", cancelSalarySlip);

export default router;
