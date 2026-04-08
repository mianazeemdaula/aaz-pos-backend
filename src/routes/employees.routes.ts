import { Router } from "express";
import {
    listEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee,
    listEmployeeLedger, listEmployeeAdvances, createEmployeeAdvance,
    approveAdvance, rejectAdvance, repayAdvance, waiveAdvance,
} from "../controllers/employees.controller";

const router = Router();

router.get("/", listEmployees);
router.get("/:id", getEmployee);
router.post("/", createEmployee);
router.put("/:id", updateEmployee);
router.delete("/:id", deleteEmployee);

// Ledger
router.get("/:id/ledger", listEmployeeLedger);

// Advances
router.get("/:id/advances", listEmployeeAdvances);
router.post("/:id/advances", createEmployeeAdvance);
router.patch("/:id/advances/:advId/approve", approveAdvance);
router.patch("/:id/advances/:advId/reject", rejectAdvance);
router.patch("/:id/advances/:advId/repay", repayAdvance);
router.patch("/:id/advances/:advId/waive", waiveAdvance);

export default router;
