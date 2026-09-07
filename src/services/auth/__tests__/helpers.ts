import { defaultPermissions, flattenPermissions } from "../permission-rules";
import { PERMISSION_MODULES, permissionKey } from "../permission-modules";
import type { PermissionAction, PermissionModule, UserPermissions } from "../permission-modules";
import type { AccessProfile } from "../authorize-rules";

/** Grants to layer on top of a baseline, e.g. `{ products: ["view", "edit"] }`. */
export type Grants = Partial<Record<PermissionModule, readonly PermissionAction[]>>;

/** Permissions with nothing allowed. */
export function noPermissions(): UserPermissions {
    const perms = {} as UserPermissions;
    for (const module of PERMISSION_MODULES) {
        perms[module] = { view: false, edit: false, delete: false };
    }
    return perms;
}

/** Start from a role's baseline (or nothing) and switch specific grants on. */
export function permissionsWith(grants: Grants, role?: string): UserPermissions {
    const perms = role ? defaultPermissions(role) : noPermissions();
    for (const [module, actions] of Object.entries(grants) as [PermissionModule, PermissionAction[]][]) {
        for (const action of actions) perms[module][action] = true;
    }
    return perms;
}

/** The flat `perm.*` settings the admin screen would save for these permissions. */
export const savedSettings = (perms: UserPermissions): Record<string, unknown> => flattenPermissions(perms);

/** One saved permission key, for asserting the storage contract. */
export const savedKey = (module: PermissionModule, action: PermissionAction): string =>
    permissionKey(module, action);

export function profile(overrides: Partial<AccessProfile> = {}): AccessProfile {
    return {
        userId: overrides.userId ?? 1,
        role: overrides.role ?? "CASHIER",
        active: overrides.active ?? true,
        permissions: overrides.permissions ?? defaultPermissions(overrides.role ?? "CASHIER"),
        ...overrides,
    };
}

/** An administrator: every check must pass regardless of stored permissions. */
export const adminProfile = (overrides: Partial<AccessProfile> = {}): AccessProfile =>
    profile({ userId: 99, role: "ADMIN", ...overrides });

/** A cashier who has never had permissions configured — the role defaults apply. */
export const defaultCashier = (overrides: Partial<AccessProfile> = {}): AccessProfile =>
    profile({ userId: 2, role: "CASHIER", ...overrides });

/** A user with an explicit, configured permission set. */
export const configuredUser = (
    grants: Grants,
    overrides: Partial<AccessProfile> = {}
): AccessProfile =>
    profile({
        userId: 3,
        role: overrides.role ?? "MANAGER",
        permissions: permissionsWith(grants),
        ...overrides,
    });
