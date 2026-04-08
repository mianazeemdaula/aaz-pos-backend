import { Router } from "express";
import {
    listRecurringExpenses, getRecurringExpense, createRecurringExpense,
    updateRecurringExpense, deleteRecurringExpense,
} from "../controllers/expenses.controller";

const router = Router();

router.get("/", listRecurringExpenses);
router.get("/:id", getRecurringExpense);
router.post("/", createRecurringExpense);
router.put("/:id", updateRecurringExpense);
router.delete("/:id", deleteRecurringExpense);

export default router;
