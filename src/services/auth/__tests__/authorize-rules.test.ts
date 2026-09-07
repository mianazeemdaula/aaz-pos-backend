import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideAuthorization, requirementsFor, resolveModule } from "../authorize-rules";
import { CATALOGUE_READERS } from "../route-access";
import { adminProfile, configuredUser, defaultCashier, profile } from "./helpers";

describe("authorize: who is refused before permissions are even consulted", () => {
    const req = { userId: 1, method: "GET", module: "products" } as const;

    it("401s a request with no user", () => {
        const d = decideAuthorization({ ...req, userId: null }, adminProfile());
        assert.equal(d.allowed, false);
        assert.equal(d.status, 401);
        assert.equal(d.error, "Unauthorized");
    });

    it("401s a token whose account has since been deleted", () => {
        const d = decideAuthorization(req, null);
        assert.equal(d.allowed, false);
        assert.equal(d.status, 401);
        assert.match(String(d.error), /no longer exists/);
    });

    it("403s a deactivated account even if it is an administrator", () => {
        const d = decideAuthorization(req, adminProfile({ active: false }));
        assert.equal(d.allowed, false);
        assert.equal(d.status, 403);
        assert.match(String(d.error), /inactive/);
    });
});

describe("authorize: module and action resolution", () => {
    it("uses one module for every action when given a plain name", () => {
        assert.equal(resolveModule("customers", "view"), "customers");
        assert.equal(resolveModule("customers", "delete"), "customers");
    });

    it("splits a resource that has two faces", () => {
        const spec = { view: "sale-history", edit: "sales", delete: "sale-history" } as const;
        assert.equal(resolveModule(spec, "view"), "sale-history");
        assert.equal(resolveModule(spec, "edit"), "sales");
        assert.equal(resolveModule(spec, "delete"), "sale-history");
    });

    it("derives the action from the HTTP verb", () => {
        const spec = { view: "sale-history", edit: "sales", delete: "sale-history" } as const;
        const user = configuredUser({ sales: ["edit"] });

        assert.equal(decideAuthorization({ userId: 3, method: "POST", module: spec }, user).allowed, true);
        assert.equal(decideAuthorization({ userId: 3, method: "GET", module: spec }, user).allowed, false);
        assert.equal(decideAuthorization({ userId: 3, method: "DELETE", module: spec }, user).allowed, false);
    });

    it("honours an explicitly forced action over the verb", () => {
        const user = configuredUser({ settings: ["view"] });
        // A GET that must nonetheless be treated as a write.
        const d = decideAuthorization(
            { userId: 3, method: "GET", module: "settings", options: { action: "edit" } },
            user
        );
        assert.equal(d.allowed, false);
        assert.equal(d.action, "edit");
    });

    it("names the module and action it refused, for a usable error", () => {
        const d = decideAuthorization({ userId: 2, method: "DELETE", module: "products" }, defaultCashier());
        assert.equal(d.module, "products");
        assert.equal(d.action, "delete");
        assert.equal(d.error, "You do not have permission to delete products");
    });
});

describe("authorize: reference data the till must read", () => {
    const cashier = defaultCashier(); // holds sales.edit, and no products permission

    it("lets a cashier read the catalogue to ring up a sale", () => {
        const d = decideAuthorization(
            { userId: 2, method: "GET", module: "products", options: { readableBy: CATALOGUE_READERS } },
            cashier
        );
        assert.equal(d.allowed, true);
    });

    it("still refuses that cashier the right to change the catalogue", () => {
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
            const d = decideAuthorization(
                { userId: 2, method, module: "products", options: { readableBy: CATALOGUE_READERS } },
                cashier
            );
            assert.equal(d.allowed, false, `${method} /products should be refused`);
            assert.equal(d.status, 403);
        }
    });

    it("refuses a user who can neither transact nor read the module", () => {
        const clerk = configuredUser({ employees: ["view"] });
        const d = decideAuthorization(
            { userId: 3, method: "GET", module: "products", options: { readableBy: CATALOGUE_READERS } },
            clerk
        );
        assert.equal(d.allowed, false);
    });

    it("does not widen reads when no alternatives are given", () => {
        const d = decideAuthorization({ userId: 2, method: "GET", module: "products" }, cashier);
        assert.equal(d.allowed, false);
    });

    it("lists the alternatives only for reads", () => {
        const opts = { readableBy: CATALOGUE_READERS };
        assert.ok(requirementsFor("products", "view", opts).length > 1);
        assert.deepEqual(requirementsFor("products", "edit", opts), [{ module: "products", action: "edit" }]);
        assert.deepEqual(requirementsFor("products", "delete", opts), [
            { module: "products", action: "delete" },
        ]);
    });

    it("reports the module's own name when refusing, not an alternative's", () => {
        const d = decideAuthorization(
            { userId: 3, method: "GET", module: "accounts", options: { readableBy: CATALOGUE_READERS } },
            configuredUser({ employees: ["view"] })
        );
        assert.equal(d.module, "accounts");
    });
});

describe("authorize: the administrator bypass", () => {
    it("passes an administrator through every module and verb", () => {
        const admin = adminProfile();
        for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
            assert.equal(decideAuthorization({ userId: 99, method, module: "users" }, admin).allowed, true);
            assert.equal(decideAuthorization({ userId: 99, method, module: "settings" }, admin).allowed, true);
        }
    });

    it("holds even when the stored set denies everything", () => {
        const admin = profile({ role: "ADMIN", permissions: configuredUser({}).permissions });
        assert.equal(decideAuthorization({ userId: 1, method: "DELETE", module: "users" }, admin).allowed, true);
    });

    it("comes from the live role, so a demoted admin loses it", () => {
        const demoted = profile({ role: "CASHIER", permissions: configuredUser({}).permissions });
        assert.equal(decideAuthorization({ userId: 1, method: "DELETE", module: "users" }, demoted).allowed, false);
    });
});
