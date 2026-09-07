import { actionForMethod, can } from "./permission-rules";
import type { PermissionAction, PermissionModule, UserPermissions } from "./permission-modules";

/**
 * The authorisation decision, as pure functions.
 *
 * Deliberately free of Express and Prisma so every branch — the module a route
 * maps to, the action an HTTP verb implies, and who is refused — can be
 * asserted directly. `authorize.ts` is the thin Express wrapper around this.
 */

/** A user's live access, as loaded by the store. */
export interface AccessProfile {
    userId: number;
    role: string;
    active: boolean;
    permissions: UserPermissions;
}

/** One way to satisfy a route: hold `action` on `module`. */
export interface Requirement {
    module: PermissionModule;
    action: PermissionAction;
}

/**
 * Which module a route belongs to. Most routers name one module; a few serve
 * two faces of the same resource — recording a sale is the `sales` module,
 * while listing or voiding past ones is `sale-history` — so those give a module
 * per action.
 */
export type ModuleSpec = PermissionModule | Partial<Record<PermissionAction, PermissionModule>>;

export interface AuthorizeOptions {
    /** Force the action instead of deriving it from the HTTP method. */
    action?: PermissionAction;
    /**
     * Extra ways to satisfy a READ.
     *
     * Permissions are granted per screen, but a screen needs reference data it
     * does not own: the till has to look up products, payment accounts and
     * customers to ring up a sale. Listing those here lets a cashier read them
     * without being handed the Products or Accounts screens. Writes are never
     * widened this way — they always need the module's own permission.
     */
    readableBy?: readonly Requirement[];
}

export const resolveModule = (spec: ModuleSpec, action: PermissionAction): PermissionModule =>
    typeof spec === "string" ? spec : (spec[action] ?? spec.view ?? spec.edit ?? spec.delete)!;

/** Every requirement that would satisfy this route, in "any of" order. */
export function requirementsFor(
    spec: ModuleSpec,
    action: PermissionAction,
    options: AuthorizeOptions = {}
): Requirement[] {
    const primary: Requirement = { module: resolveModule(spec, action), action };
    if (action !== "view" || !options.readableBy?.length) return [primary];
    return [primary, ...options.readableBy];
}

export interface AuthorizationRequest {
    userId: number | null;
    method: string;
    module: ModuleSpec;
    options?: AuthorizeOptions;
}

export interface AuthorizationDecision {
    allowed: boolean;
    status: 200 | 401 | 403;
    error?: string;
    module?: PermissionModule;
    action?: PermissionAction;
}

/** The whole decision as a pure function of the request and the loaded profile. */
export function decideAuthorization(
    req: AuthorizationRequest,
    profile: AccessProfile | null
): AuthorizationDecision {
    if (req.userId == null) return { allowed: false, status: 401, error: "Unauthorized" };
    if (!profile) return { allowed: false, status: 401, error: "Account no longer exists" };
    if (!profile.active) return { allowed: false, status: 403, error: "Account is inactive" };

    const options = req.options ?? {};
    const action = options.action ?? actionForMethod(req.method);
    const requirements = requirementsFor(req.module, action, options);
    const granted = requirements.some((r) => can(profile.permissions, r.module, r.action, profile.role));

    const module = requirements[0].module;
    if (!granted) {
        return {
            allowed: false,
            status: 403,
            error: `You do not have permission to ${action} ${module}`,
            module,
            action,
        };
    }

    return { allowed: true, status: 200, module, action };
}
