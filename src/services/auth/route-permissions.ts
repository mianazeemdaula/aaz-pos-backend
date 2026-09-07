import type { AuthorizeOptions, ModuleSpec } from "./authorize-rules";
import { CATALOGUE_READERS } from "./route-access";

/**
 * Which permission every API mount point demands.
 *
 * This table is the single description of the app's access surface. `routes`
 * builds the router from it and refuses to start if a mount point is missing an
 * entry, so a new module cannot be added without deciding who may reach it —
 * which is exactly how the whole API ended up unguarded before.
 */

export interface RoutePolicy {
    /** Mount path under the API root. */
    path: string;
    /** Human name for the resource, used in test output and error messages. */
    label: string;
    /**
     * The module(s) this mount demands. `undefined` means the router guards
     * each of its own routes because a single rule would be wrong for all of
     * them (settings, reports).
     */
    module?: ModuleSpec;
    options?: AuthorizeOptions;
    /** Why this mount is guarded the way it is. */
    note?: string;
}

export const ROUTE_POLICIES: readonly RoutePolicy[] = [
    // ─── Reference data ─────────────────────────────────────────────────────
    // Readable by anyone who can transact; writable only with the module's own
    // permission.
    { path: "/products", label: "Products", module: "products", options: { readableBy: CATALOGUE_READERS } },
    { path: "/packages", label: "Packages", module: "products", options: { readableBy: CATALOGUE_READERS } },
    { path: "/categories", label: "Categories", module: "categories", options: { readableBy: CATALOGUE_READERS } },
    { path: "/brands", label: "Brands", module: "brands", options: { readableBy: CATALOGUE_READERS } },
    { path: "/accounts", label: "Accounts", module: "accounts", options: { readableBy: CATALOGUE_READERS } },
    { path: "/customers", label: "Customers", module: "customers", options: { readableBy: CATALOGUE_READERS } },
    { path: "/suppliers", label: "Suppliers", module: "suppliers", options: { readableBy: CATALOGUE_READERS } },
    { path: "/promotions", label: "Promotions", module: "promotions", options: { readableBy: CATALOGUE_READERS } },
    {
        path: "/tax-schedules",
        label: "Tax schedules",
        module: "settings",
        options: { readableBy: CATALOGUE_READERS },
        note: "Tax rates are configuration, but the till must read them to price a line.",
    },

    // ─── Transactions ───────────────────────────────────────────────────────
    {
        path: "/sales",
        label: "Sales",
        module: { view: "sale-history", edit: "sales", delete: "sale-history" },
        note: "Ringing up a sale is the till; browsing or voiding past ones is the history screen.",
    },
    {
        path: "/purchases",
        label: "Purchases",
        module: { view: "purchase-history", edit: "purchases", delete: "purchase-history" },
        note: "Same split as sales.",
    },
    { path: "/held", label: "Held transactions", module: "held" },
    { path: "/advance-bookings", label: "Advance bookings", module: "advance-bookings" },
    { path: "/stock-movements", label: "Stock adjustments", module: "stock-adjustments" },

    // ─── HR & finance ───────────────────────────────────────────────────────
    { path: "/employees", label: "Employees", module: "employees" },
    { path: "/salary-slips", label: "Salary slips", module: "salary-slips" },
    { path: "/expenses", label: "Expenses", module: "expenses" },
    { path: "/recurring-expenses", label: "Recurring expenses", module: "expenses" },

    // ─── Admin ──────────────────────────────────────────────────────────────
    { path: "/users", label: "Users", module: "users" },
    { path: "/data", label: "Import / export", module: "settings" },
    {
        path: "/reports",
        label: "Reports",
        note: "Guarded per route: /reports/dashboard is the dashboard module, the rest is reports.",
    },
    {
        path: "/settings",
        label: "Settings",
        note: "Guarded per route: everyone reads the company profile and their own permissions; writing is the settings module.",
    },
];

/** Mount points whose router applies its own per-route guards. */
export const PER_ROUTE_GUARDED: readonly string[] = ROUTE_POLICIES.filter((p) => !p.module).map((p) => p.path);

export const policyFor = (path: string): RoutePolicy | undefined =>
    ROUTE_POLICIES.find((p) => p.path === path);

/**
 * The complete list of endpoints any signed-in user may reach regardless of
 * their permissions.
 *
 * Two routers guard themselves rather than take a blanket rule, and each starts
 * with its exceptions and then applies a catch-all — so anything added later is
 * guarded by default. This list is that set of exceptions, written down so it
 * can be reviewed and tested: every entry needs a reason a cashier must be able
 * to call it, and the test below fails the moment the list grows.
 */
export interface OpenRoute {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    why: string;
}

export const OPEN_TO_ANY_SIGNED_IN_USER: readonly OpenRoute[] = [
    {
        method: "GET",
        path: "/settings",
        why: "Business name, currency and tax defaults — every receipt and price is rendered from them.",
    },
    {
        method: "GET",
        path: "/settings/logo",
        why: "Printed on the receipt.",
    },
    {
        method: "GET",
        path: "/settings/app",
        why: "Till behaviour flags the sale screen reads on load.",
    },
    {
        method: "GET",
        path: "/settings/users/:userId",
        why: "Own permissions only — the client cannot finish signing in without them. Anyone else's needs settings.view.",
    },
    {
        method: "GET",
        path: "/reports/dashboard",
        why: "The dashboard tiles are the `dashboard` module, not `reports`; guarded as such inside the router.",
    },
];
