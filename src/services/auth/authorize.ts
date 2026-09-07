import type { NextFunction, Request, Response } from "express";
import { getAccessProfile } from "./permission-store";
import { decideAuthorization, type AuthorizeOptions, type ModuleSpec } from "./authorize-rules";
import type { PermissionAction, PermissionModule } from "./permission-modules";

/**
 * Express bindings for the authorisation rules.
 *
 * Until this existed, permissions were enforced only by the POS client, so any
 * signed-in user could reach any endpoint with a direct HTTP call regardless of
 * what their screen showed them. All the judgement lives in authorize-rules.ts;
 * this file only loads the profile and turns the verdict into a response.
 */

/**
 * Guard a router or a single route. The action comes from the HTTP method
 * unless one is given explicitly.
 *
 *   router.use(authorize("customers"))
 *   router.post("/", authorize("users", { action: "edit" }), createUser)
 */
export function authorize(module: ModuleSpec, options: AuthorizeOptions = {}) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = req.user?.id ?? null;

        try {
            const profile = userId == null ? null : await getAccessProfile(userId);
            const decision = decideAuthorization({ userId, method: req.method, module, options }, profile);

            if (!decision.allowed) {
                res.status(decision.status).json({ error: decision.error });
                return;
            }

            // Downstream handlers read the live role, not the one baked into the token.
            if (profile) req.user = { ...req.user!, role: profile.role };
            next();
        } catch (err) {
            console.error("Authorization check failed:", err);
            res.status(500).json({ error: "Authorization check failed" });
        }
    };
}

/** Restrict a route to specific roles, independent of module permissions. */
export function requireRole(...roles: string[]) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = req.user?.id ?? null;
        if (userId == null) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        try {
            const profile = await getAccessProfile(userId);
            if (!profile) {
                res.status(401).json({ error: "Account no longer exists" });
                return;
            }
            if (!profile.active) {
                res.status(403).json({ error: "Account is inactive" });
                return;
            }
            if (!roles.includes(profile.role)) {
                res.status(403).json({ error: "Forbidden" });
                return;
            }

            req.user = { ...req.user!, role: profile.role };
            next();
        } catch (err) {
            console.error("Role check failed:", err);
            res.status(500).json({ error: "Authorization check failed" });
        }
    };
}

/**
 * Allow a user to reach their own record, and anyone else only with the given
 * permission. Used for per-user settings: everybody must be able to read their
 * own permissions to start the client, but reading — or writing — someone
 * else's is an administrative act.
 */
export function allowSelfOr(module: PermissionModule, action: PermissionAction, param = "id") {
    const fallback = authorize(module, { action });

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = req.user?.id ?? null;
        if (userId == null) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const target = Number(req.params[param]);
        if (Number.isFinite(target) && target === userId) {
            next();
            return;
        }

        await fallback(req, res, next);
    };
}

/**
 * Open only while the system has no accounts at all — the first-run bootstrap
 * that creates the owner's login. Once anybody exists this behaves exactly like
 * `authenticate` + `authorize`, which is what stops a stranger POSTing
 * themselves an administrator account on a live till.
 */
export function bootstrapOrAuthorize(
    countUsers: () => Promise<number>,
    authenticateFn: (req: Request, res: Response, next: NextFunction) => void,
    module: PermissionModule,
    action: PermissionAction
) {
    const guard = authorize(module, { action });

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if ((await countUsers()) === 0) {
                (req as Request & { isBootstrap?: boolean }).isBootstrap = true;
                next();
                return;
            }
        } catch (err) {
            console.error("Bootstrap check failed:", err);
            res.status(500).json({ error: "Authorization check failed" });
            return;
        }

        authenticateFn(req, res, () => {
            void guard(req, res, next);
        });
    };
}
