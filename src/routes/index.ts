import { Router } from "express";
import authRouter from "./auth";
import { authenticate } from "../middleware/auth";
import { authorize, ROUTE_POLICIES } from "../services/auth";
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
import taxSchedulesRouter from "./tax-schedules.routes";
import importExportRouter from "./import-export.routes";

const router = Router();

// The only unauthenticated surface. /auth/register guards itself.
router.use("/auth", authRouter);

/** Every mounted API resource. Keys must match ROUTE_POLICIES exactly. */
const MODULE_ROUTERS: Record<string, Router> = {
    "/products": productsRouter,
    "/packages": packagesRouter,
    "/categories": categoriesRouter,
    "/brands": brandsRouter,
    "/accounts": accountsRouter,
    "/customers": customersRouter,
    "/suppliers": suppliersRouter,
    "/promotions": promotionsRouter,
    "/tax-schedules": taxSchedulesRouter,
    "/sales": salesRouter,
    "/purchases": purchasesRouter,
    "/held": heldTransactionsRouter,
    "/advance-bookings": advanceBookingsRouter,
    "/stock-movements": stockMovementsRouter,
    "/employees": employeesRouter,
    "/salary-slips": salarySlipsRouter,
    "/expenses": expensesRouter,
    "/recurring-expenses": recurringExpensesRouter,
    "/users": usersRouter,
    "/data": importExportRouter,
    "/reports": reportsRouter,
    "/settings": settingsRouter,
};

/**
 * Wire every resource from the policy table.
 *
 * Driving the router from the table rather than by hand means a new module
 * cannot be mounted without an access decision: the checks below fail at start
 * up if a router has no policy or a policy has no router. Permissions used to
 * be enforced only in the browser, and this is what stops that recurring.
 */
const policyPaths = new Set(ROUTE_POLICIES.map((p) => p.path));
const routerPaths = new Set(Object.keys(MODULE_ROUTERS));

for (const path of routerPaths) {
    if (!policyPaths.has(path)) {
        throw new Error(`Route "${path}" is mounted with no entry in ROUTE_POLICIES — who may reach it?`);
    }
}
for (const path of policyPaths) {
    if (!routerPaths.has(path)) {
        throw new Error(`ROUTE_POLICIES lists "${path}" but no router is mounted there.`);
    }
}

for (const policy of ROUTE_POLICIES) {
    const resource = MODULE_ROUTERS[policy.path];

    if (policy.module) {
        router.use(policy.path, authenticate, authorize(policy.module, policy.options), resource);
    } else {
        // Guards itself per route — one blanket rule would be wrong for all of them.
        router.use(policy.path, authenticate, resource);
    }
}

export default router;
