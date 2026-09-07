import {
    ADMIN_ROLE,
    PERMISSION_ACTIONS,
    PERMISSION_MODULES,
    permissionKey,
    type PermissionAction,
    type PermissionModule,
    type UserPermissions,
} from "./permission-modules";

/**
 * Pure permission logic — no Express, no Prisma, so every rule here is directly
 * testable. It reproduces the client's model exactly (defaults, parsing and the
 * admin bypass) so a screen the UI hides is also a call the API refuses.
 */

/** Modules a non-admin can see when nothing has been configured for them. */
const DEFAULT_NON_ADMIN_VIEW: ReadonlySet<PermissionModule> = new Set<PermissionModule>([
    "dashboard",
    "sales",
    "sale-history",
    "held",
    "payments",
]);

/** Modules a non-admin can write to when nothing has been configured for them. */
const DEFAULT_NON_ADMIN_EDIT: ReadonlySet<PermissionModule> = new Set<PermissionModule>(["sales"]);

export const isAdmin = (role: string | null | undefined): boolean => role === ADMIN_ROLE;

/**
 * Baseline for a role. An administrator gets everything; anyone else starts
 * with the till and their own sales history and nothing more — a new account
 * must be granted access deliberately rather than inherit it.
 */
export function defaultPermissions(role?: string | null): UserPermissions {
    const admin = isAdmin(role);
    const result = {} as UserPermissions;

    for (const module of PERMISSION_MODULES) {
        result[module] = admin
            ? { view: true, edit: true, delete: true }
            : {
                  view: DEFAULT_NON_ADMIN_VIEW.has(module),
                  edit: DEFAULT_NON_ADMIN_EDIT.has(module),
                  delete: false,
              };
    }

    return result;
}

const isTrue = (v: unknown): boolean => v === true || v === "true";

/**
 * Build permissions from the flat `perm.<module>.<action>` settings the admin
 * screen writes.
 *
 * When the user has no `perm.*` key at all they have never been configured, so
 * the role default applies. Once even one key exists the saved set is
 * authoritative and anything absent from it is denied — otherwise revoking the
 * last permission in a module would silently restore the defaults.
 */
export function parsePermissions(
    raw: Record<string, unknown> | null | undefined,
    role?: string | null
): UserPermissions {
    const settings = raw ?? {};

    const configured = Object.keys(settings).some((k) => k.startsWith("perm."));
    if (!configured) return defaultPermissions(role);

    const result = {} as UserPermissions;
    for (const module of PERMISSION_MODULES) {
        result[module] = { view: false, edit: false, delete: false };
        for (const action of PERMISSION_ACTIONS) {
            const key = permissionKey(module, action);
            if (key in settings) result[module][action] = isTrue(settings[key]);
        }
    }

    return result;
}

/** Flatten permissions back into the storage shape. */
export function flattenPermissions(perms: UserPermissions): Record<string, boolean> {
    const flat: Record<string, boolean> = {};
    for (const module of PERMISSION_MODULES) {
        for (const action of PERMISSION_ACTIONS) {
            flat[permissionKey(module, action)] = perms[module][action];
        }
    }
    return flat;
}

/** The one question the middleware asks. Administrators always pass. */
export function can(
    perms: UserPermissions,
    module: PermissionModule,
    action: PermissionAction,
    role?: string | null
): boolean {
    if (isAdmin(role)) return true;
    return perms[module]?.[action] ?? false;
}

/**
 * Which action an HTTP method represents.
 * Reads are `view`, writes are `edit`, and DELETE is its own action so it can
 * be withheld from someone who may still create and correct records.
 */
export function actionForMethod(method: string): PermissionAction {
    switch (method.toUpperCase()) {
        case "GET":
        case "HEAD":
        case "OPTIONS":
            return "view";
        case "DELETE":
            return "delete";
        default:
            return "edit";
    }
}
