/**
 * The permission vocabulary. This list, the action names and the storage key
 * shape are a contract with the POS client — see
 * aaz-pos/src/contexts/SettingsContext.tsx. Changing a module name here without
 * changing it there silently drops a permission back to "denied".
 */

export const PERMISSION_MODULES = [
    // Quick Actions
    "dashboard",
    "sales",
    "purchases",
    "advance-bookings",
    // History
    "held",
    "sale-history",
    "purchase-history",
    "returns",
    "payments",
    // Inventory
    "products",
    "print-labels",
    "categories",
    "brands",
    "stock-adjustments",
    // Parties
    "customers",
    "suppliers",
    // HR & Finance
    "employees",
    "salary-slips",
    "expenses",
    "accounts",
    "promotions",
    // Admin
    "reports",
    "users",
    "settings",
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const PERMISSION_ACTIONS = ["view", "edit", "delete"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type ModulePermission = Record<PermissionAction, boolean>;
export type UserPermissions = Record<PermissionModule, ModulePermission>;

export const USER_ROLES = ["ADMIN", "MANAGER", "CASHIER", "DELIVERY_BOY", "WORKER"] as const;
export type UserRoleName = (typeof USER_ROLES)[number];

/** Administrators bypass every check, matching the client. */
export const ADMIN_ROLE: UserRoleName = "ADMIN";

const MODULE_SET: ReadonlySet<string> = new Set(PERMISSION_MODULES);
const ACTION_SET: ReadonlySet<string> = new Set(PERMISSION_ACTIONS);

export const isPermissionModule = (v: string): v is PermissionModule => MODULE_SET.has(v);
export const isPermissionAction = (v: string): v is PermissionAction => ACTION_SET.has(v);

/** Storage key for one permission, under the per-user settings prefix. */
export const permissionKey = (module: PermissionModule, action: PermissionAction): string =>
    `perm.${module}.${action}`;
