import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideAuthorization, resolveModule } from "../authorize-rules";
import {
    OPEN_TO_ANY_SIGNED_IN_USER,
    ROUTE_POLICIES,
    policyFor,
    type RoutePolicy,
} from "../route-permissions";
import { DASHBOARD_READERS } from "../route-access";
import { PERMISSION_ACTIONS, PERMISSION_MODULES, type PermissionModule } from "../permission-modules";
import { actionForMethod } from "../permission-rules";
import { adminProfile, configuredUser, defaultCashier, permissionsWith, profile } from "./helpers";

const WRITE_METHODS = ["POST", "PUT", "PATCH"] as const;
const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Ask a policy the same question the middleware would. */
const check = (policy: RoutePolicy, method: string, prof: Parameters<typeof decideAuthorization>[1]) =>
    decideAuthorization(
        { userId: prof?.userId ?? 1, method, module: policy.module!, options: policy.options },
        prof
    );

const guarded = ROUTE_POLICIES.filter((p) => p.module);
const perRoute = ROUTE_POLICIES.filter((p) => !p.module);

describe("route policy table: completeness", () => {
    it("covers every mount point exactly once", () => {
        const paths = ROUTE_POLICIES.map((p) => p.path);
        assert.deepEqual(paths, [...new Set(paths)], "duplicate mount path in ROUTE_POLICIES");
        assert.ok(paths.length >= 22, `expected the full API surface, found ${paths.length}`);
    });

    it("names a module or explains why it guards itself", () => {
        for (const policy of ROUTE_POLICIES) {
            assert.ok(policy.module || policy.note, `${policy.path} has neither a module nor a note`);
        }
    });

    it("only guards itself where a single blanket rule would be wrong", () => {
        assert.deepEqual(
            perRoute.map((p) => p.path).sort(),
            ["/reports", "/settings"],
            "a new self-guarding router must be justified here"
        );
    });

    it("uses only real module names", () => {
        const known = new Set<string>(PERMISSION_MODULES);
        for (const policy of guarded) {
            for (const action of PERMISSION_ACTIONS) {
                const module = resolveModule(policy.module!, action);
                assert.ok(known.has(module), `${policy.path} maps ${action} to unknown module "${module}"`);
            }
        }
    });

    it("is reachable by path lookup", () => {
        assert.equal(policyFor("/sales")?.label, "Sales");
        assert.equal(policyFor("/nope"), undefined);
    });
});

describe("every module is enforced: an unprivileged user is refused everywhere", () => {
    // Somebody with a valid login and no permissions at all.
    const nobody = profile({ userId: 5, role: "WORKER", permissions: permissionsWith({}) });

    for (const policy of guarded) {
        it(`${policy.label} (${policy.path}) refuses every verb`, () => {
            for (const method of ALL_METHODS) {
                const d = check(policy, method, nobody);
                assert.equal(d.allowed, false, `${method} ${policy.path} should be refused`);
                assert.equal(d.status, 403);
            }
        });
    }
});

describe("every module is enforced: an administrator reaches everything", () => {
    const admin = adminProfile();

    for (const policy of guarded) {
        it(`${policy.label} (${policy.path}) allows every verb`, () => {
            for (const method of ALL_METHODS) {
                assert.equal(check(policy, method, admin).allowed, true, `${method} ${policy.path}`);
            }
        });
    }
});

describe("every module is enforced: the exact permission unlocks the exact route", () => {
    for (const policy of guarded) {
        it(`${policy.label} (${policy.path}) opens only to its own module permission`, () => {
            for (const method of ALL_METHODS) {
                const action = actionForMethod(method);
                const module = resolveModule(policy.module!, action);

                // Granted precisely the permission this route asks for.
                const granted = configuredUser({ [module]: [action] } as never, { userId: 7 });
                assert.equal(check(policy, method, granted).allowed, true, `${method} ${policy.path} with ${module}.${action}`);

                // Granted every OTHER permission on the same module.
                const otherActions = PERMISSION_ACTIONS.filter((a) => a !== action);
                const wrongAction = configuredUser({ [module]: otherActions } as never, { userId: 8 });
                const d = check(policy, method, wrongAction);
                const widenedRead = action === "view" && !!policy.options?.readableBy?.length;
                if (!widenedRead) {
                    assert.equal(d.allowed, false, `${method} ${policy.path} should need ${module}.${action}`);
                }
            }
        });
    }
});

describe("the till works for a default cashier", () => {
    const cashier = defaultCashier();
    const at = (path: string) => policyFor(path)!;

    it("can ring up a sale", () => {
        assert.equal(check(at("/sales"), "POST", cashier).allowed, true);
    });

    it("can read the catalogue, accounts, customers and tax rates it needs", () => {
        for (const path of [
            "/products",
            "/packages",
            "/categories",
            "/brands",
            "/accounts",
            "/customers",
            "/suppliers",
            "/promotions",
            "/tax-schedules",
        ]) {
            assert.equal(check(at(path), "GET", cashier).allowed, true, `GET ${path}`);
        }
    });

    it("can park and resume a held sale", () => {
        assert.equal(check(at("/held"), "GET", cashier).allowed, true);
    });

    it("can review its own sales history", () => {
        assert.equal(check(at("/sales"), "GET", cashier).allowed, true);
    });

    it("cannot void a past sale", () => {
        assert.equal(check(at("/sales"), "DELETE", cashier).allowed, false);
    });

    it("cannot change the catalogue, prices or accounts", () => {
        for (const path of ["/products", "/categories", "/brands", "/accounts", "/tax-schedules"]) {
            for (const method of WRITE_METHODS) {
                assert.equal(check(at(path), method, cashier).allowed, false, `${method} ${path}`);
            }
        }
    });

    it("cannot reach staff, money or configuration", () => {
        for (const path of ["/users", "/employees", "/salary-slips", "/expenses", "/data", "/stock-movements"]) {
            for (const method of ALL_METHODS) {
                assert.equal(check(at(path), method, cashier).allowed, false, `${method} ${path}`);
            }
        }
    });

    it("cannot record a purchase", () => {
        assert.equal(check(at("/purchases"), "POST", cashier).allowed, false);
    });
});

describe("escalation attempts a signed-in user might try", () => {
    const cashier = defaultCashier();

    it("cannot create a user account", () => {
        assert.equal(check(policyFor("/users")!, "POST", cashier).allowed, false);
    });

    it("cannot export or import the database", () => {
        assert.equal(check(policyFor("/data")!, "GET", cashier).allowed, false);
        assert.equal(check(policyFor("/data")!, "POST", cashier).allowed, false);
    });

    it("cannot read the catalogue once the till permission is taken away", () => {
        const revoked = configuredUser({ dashboard: ["view"] }, { userId: 9 });
        assert.equal(check(policyFor("/products")!, "GET", revoked).allowed, false);
    });

    it("cannot use a stale token after the account is deactivated", () => {
        const suspended = defaultCashier({ active: false });
        assert.equal(check(policyFor("/sales")!, "POST", suspended).allowed, false);
        assert.equal(check(policyFor("/sales")!, "POST", suspended).status, 403);
    });

    it("cannot use a token whose account was deleted", () => {
        const d = decideAuthorization({ userId: 2, method: "POST", module: "sales" }, null);
        assert.equal(d.allowed, false);
        assert.equal(d.status, 401);
    });
});

describe("a manager granted specific modules gets those and no more", () => {
    const manager = configuredUser(
        { products: ["view", "edit"], reports: ["view"], "sale-history": ["view", "delete"] },
        { userId: 4 }
    );

    it("can manage the catalogue", () => {
        assert.equal(check(policyFor("/products")!, "GET", manager).allowed, true);
        assert.equal(check(policyFor("/products")!, "PUT", manager).allowed, true);
    });

    it("cannot delete a product without the delete permission", () => {
        assert.equal(check(policyFor("/products")!, "DELETE", manager).allowed, false);
    });

    it("can void a past sale but not ring up a new one", () => {
        assert.equal(check(policyFor("/sales")!, "DELETE", manager).allowed, true);
        assert.equal(check(policyFor("/sales")!, "POST", manager).allowed, false);
    });

    it("cannot touch users or expenses", () => {
        assert.equal(check(policyFor("/users")!, "GET", manager).allowed, false);
        assert.equal(check(policyFor("/expenses")!, "POST", manager).allowed, false);
    });

    it("shares one permission across the two expense mounts", () => {
        const bookkeeper = configuredUser({ expenses: ["view", "edit"] }, { userId: 6 });
        for (const path of ["/expenses", "/recurring-expenses"]) {
            assert.equal(check(policyFor(path)!, "GET", bookkeeper).allowed, true, `GET ${path}`);
            assert.equal(check(policyFor(path)!, "POST", bookkeeper).allowed, true, `POST ${path}`);
        }
    });
});

describe("no permission module has been left unreachable", () => {
    /**
     * Every module in the vocabulary should either guard an API mount or be a
     * client-only screen. Listing the client-only ones explicitly means adding a
     * module without wiring it up fails here rather than silently doing nothing.
     */
    const CLIENT_ONLY: PermissionModule[] = [
        "dashboard", // guarded inside /reports
        "print-labels", // renders from products already loaded
        "returns", // served by /sales
        "payments", // served by /customers and /suppliers
    ];

    it("maps every module to a route or declares it client-only", () => {
        const routed = new Set<string>();
        for (const policy of guarded) {
            for (const action of PERMISSION_ACTIONS) routed.add(resolveModule(policy.module!, action));
        }
        // Reports and settings guard themselves.
        routed.add("reports");
        routed.add("settings");

        const unreachable = PERMISSION_MODULES.filter(
            (m) => !routed.has(m) && !CLIENT_ONLY.includes(m)
        );
        assert.deepEqual(unreachable, [], `modules with no server-side enforcement: ${unreachable.join(", ")}`);
    });
});

describe("self-guarding routers: settings and reports", () => {
    /**
     * These two routers list their exceptions and then apply a catch-all, so
     * anything added later is guarded by default. The exception list is pinned
     * here: widening it has to be a deliberate edit to this test.
     */
    it("keeps the open-route list to exactly the endpoints sign-in needs", () => {
        assert.deepEqual(
            OPEN_TO_ANY_SIGNED_IN_USER.map((r) => `${r.method} ${r.path}`),
            [
                "GET /settings",
                "GET /settings/logo",
                "GET /settings/app",
                "GET /settings/users/:userId",
                "GET /reports/dashboard",
            ]
        );
    });

    it("gives a reason for every open route, and opens none for writing", () => {
        for (const route of OPEN_TO_ANY_SIGNED_IN_USER) {
            assert.equal(route.method, "GET", `${route.path} must not be open for writing`);
            assert.ok(route.why.length > 20, `${route.path} needs a real justification`);
        }
    });

    it("guards every settings write behind the settings module", () => {
        const cashier = defaultCashier();
        for (const method of ["PUT", "POST", "DELETE"]) {
            const d = decideAuthorization({ userId: 2, method, module: "settings" }, cashier);
            assert.equal(d.allowed, false, `${method} /settings should be refused`);
        }
        assert.equal(
            decideAuthorization({ userId: 99, method: "PUT", module: "settings" }, adminProfile()).allowed,
            true
        );
    });

    it("stops a cashier writing anyone's permissions", () => {
        // PUT /settings/users/:id is what would let a user grant themselves rights.
        const d = decideAuthorization(
            { userId: 2, method: "PUT", module: "settings", options: { action: "edit" } },
            defaultCashier()
        );
        assert.equal(d.allowed, false);
        assert.equal(d.status, 403);
    });

    it("stops a cashier reading everyone's permissions in bulk", () => {
        // GET /settings/users (no :userId) is the bulk listing — settings.view.
        assert.equal(
            decideAuthorization({ userId: 2, method: "GET", module: "settings" }, defaultCashier()).allowed,
            false
        );
    });

    it("lets a settings manager read and write configuration without being an admin", () => {
        const configurator = configuredUser({ settings: ["view", "edit"] }, { userId: 10 });
        assert.equal(
            decideAuthorization({ userId: 10, method: "GET", module: "settings" }, configurator).allowed,
            true
        );
        assert.equal(
            decideAuthorization({ userId: 10, method: "PUT", module: "settings" }, configurator).allowed,
            true
        );
    });

    it("shows the dashboard to a cashier but no other report", () => {
        const cashier = defaultCashier();
        // /reports/dashboard — the dashboard module satisfies it.
        assert.equal(
            decideAuthorization(
                { userId: 2, method: "GET", module: "reports", options: { readableBy: DASHBOARD_READERS } },
                cashier
            ).allowed,
            true
        );
        // Every other report — reports.view only.
        assert.equal(
            decideAuthorization({ userId: 2, method: "GET", module: "reports" }, cashier).allowed,
            false
        );
    });

    it("shows every report to someone granted the reports module", () => {
        const analyst = configuredUser({ reports: ["view"] }, { userId: 11 });
        assert.equal(
            decideAuthorization({ userId: 11, method: "GET", module: "reports" }, analyst).allowed,
            true
        );
    });

    it("does not let the dashboard grant stand in for the reports module", () => {
        const viewer = configuredUser({ dashboard: ["view"] }, { userId: 12 });
        assert.equal(
            decideAuthorization({ userId: 12, method: "GET", module: "reports" }, viewer).allowed,
            false
        );
    });
});
