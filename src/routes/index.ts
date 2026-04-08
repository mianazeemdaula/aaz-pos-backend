import { Router } from "express";
import authRouter from "./auth";
import { authenticate } from "../middleware/auth";
import usersRouter from "./users.routes";
import accountsRouter from "./accounts.routes";
import customersRouter from "./customers.routes";
import suppliersRouter from "./suppliers.routes";
import categoriesRouter from "./categories.routes";
import brandsRouter from "./brands.routes";
import productsRouter from "./products.routes";
import salesRouter from "./sales.routes";
import purchasesRouter from "./purchases.routes";
import packagesRouter from "./packages.routes";
import employeesRouter from "./employees.routes";
import salarySlipsRouter from "./salary-slips.routes";
import recurringExpensesRouter from "./recurring-expenses.routes";
import advanceBookingsRouter from "./advance-bookings.routes";
import promotionsRouter from "./promotions.routes";
import heldTransactionsRouter from "./held-transactions.routes";
import reportsRouter from "./reports.routes";
import stockMovementsRouter from "./stock-movements.routes";
import expensesRouter from "./expenses.routes";
import settingsRouter from "./settings.routes";

const router = Router();

router.use("/auth", authRouter);

// All routes below require authentication
router.use("/users", authenticate, usersRouter);
router.use("/accounts", authenticate, accountsRouter);
router.use("/customers", authenticate, customersRouter);
router.use("/suppliers", authenticate, suppliersRouter);
router.use("/categories", authenticate, categoriesRouter);
router.use("/brands", authenticate, brandsRouter);
router.use("/products", authenticate, productsRouter);
router.use("/stock-movements", authenticate, stockMovementsRouter);
router.use("/sales", authenticate, salesRouter);
router.use("/purchases", authenticate, purchasesRouter);
router.use("/packages", authenticate, packagesRouter);
router.use("/employees", authenticate, employeesRouter);
router.use("/salary-slips", authenticate, salarySlipsRouter);
router.use("/expenses", authenticate, expensesRouter);
router.use("/recurring-expenses", authenticate, recurringExpensesRouter);
router.use("/advance-bookings", authenticate, advanceBookingsRouter);
router.use("/promotions", authenticate, promotionsRouter);
router.use("/held", authenticate, heldTransactionsRouter);
router.use("/reports", authenticate, reportsRouter);
router.use("/settings", authenticate, settingsRouter);

export default router;
