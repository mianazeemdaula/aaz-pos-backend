import { Router } from "express";
import {
    listExpenses, getExpense, createExpense, updateExpense, deleteExpense,
    listRecurringExpenses, getRecurringExpense, createRecurringExpense, updateRecurringExpense, deleteRecurringExpense,
} from "../controllers/expenses.controller";

const router = Router();

// One-time expenses
router.get("/", listExpenses);
router.get("/:id", getExpense);
router.post("/", createExpense);
router.put("/:id", updateExpense);
router.delete("/:id", deleteExpense);

export default router;
