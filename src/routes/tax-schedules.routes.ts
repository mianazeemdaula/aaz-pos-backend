import { Router } from "express";
import { listTaxSchedules, getTaxSchedule } from "../controllers/tax-schedules.controller";

const router = Router();

router.get("/", listTaxSchedules);
router.get("/:id", getTaxSchedule);

export default router;
