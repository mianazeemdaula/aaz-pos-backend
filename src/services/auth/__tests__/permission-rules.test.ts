import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    actionForMethod,
    can,
    defaultPermissions,
    flattenPermissions,
    isAdmin,
    parsePermissions,
} from "../permission-rules";
import { PERMISSION_ACTIONS, PERMISSION_MODULES, permissionKey } from "../permission-modules";
import { permissionsWith, savedSettings } from "./helpers";

describe("permission model: role defaults", () => {
    it("gives an administrator everything", () => {
        const perms = defaultPermissions("ADMIN");
        for (const module of PERMISSION_MODULES) {
            for (const action of PERMISSION_ACTIONS) {
                assert.equal(perms[module][action], true, `admin should have ${action} on ${module}`);
            }
        }
    });

    it("gives a new cashier the till and their own history, nothing else", () => {
        const perms = defaultPermissions("CASHIER");

        assert.deepEqual(perms["sales"], { view: true, edit: true, delete: false });
        assert.deepEqual(perms["dashboard"], { view: true, edit: false, delete: false });
        assert.deepEqual(perms["sale-history"], { view: true, edit: false, delete: false });
        assert.deepEqual(perms["held"], { view: true, edit: false, delete: false });
        assert.deepEqual(perms["payments"], { view: true, edit: false, delete: false });

        assert.deepEqual(perms["users"], { view: false, edit: false, delete: false });
        assert.deepEqual(perms["settings"], { view: false, edit: false, delete: false });
        assert.deepEqual(perms["reports"], { view: false, edit: false, delete: false });
        assert.deepEqual(perms["products"], { view: false, edit: false, delete: false });
    });

    it("never grants delete by default to a non-admin", () => {
        for (const role of ["MANAGER", "CASHIER", "DELIVERY_BOY", "WORKER"]) {
            const perms = defaultPermissions(role);
            for (const module of PERMISSION_MODULES) {
                assert.equal(perms[module].delete, false, `${role} should not delete ${module}`);
            }
        }
    });

    it("treats an unknown or missing role as a non-admin", () => {
        assert.equal(isAdmin("ADMIN"), true);
        assert.equal(isAdmin("MANAGER"), false);
        assert.equal(isAdmin(undefined), false);
        assert.equal(isAdmin(null), false);
        assert.equal(isAdmin("admin"), false); // case matters — no accidental grant
        assert.equal(defaultPermissions(undefined)["users"].view, false);
    });
});

describe("permission model: reading saved settings", () => {
    it("falls back to the role default when nothing was ever configured", () => {
        assert.deepEqual(parsePermissions({}, "CASHIER"), defaultPermissions("CASHIER"));
        assert.deepEqual(parsePermissions(null, "CASHIER"), defaultPermissions("CASHIER"));
        assert.deepEqual(parsePermissions(undefined, "ADMIN"), defaultPermissions("ADMIN"));
    });

    it("ignores unrelated user settings when deciding whether anything is configured", () => {
        const raw = { "printer.name": "TM-T20", "ui.theme": "dark" };
        assert.deepEqual(parsePermissions(raw, "CASHIER"), defaultPermissions("CASHIER"));
    });

    it("treats a saved set as authoritative and denies anything absent from it", () => {
        // Only one key saved: everything else must be denied, NOT defaulted.
        const raw = { [permissionKey("products", "view")]: "true" };
        const perms = parsePermissions(raw, "CASHIER");

        assert.equal(perms["products"].view, true);
        assert.equal(perms["products"].edit, false);
        // `sales` is a cashier default, but an explicit set overrides defaults.
        assert.equal(perms["sales"].edit, false);
    });

    it("reads both boolean and string values", () => {
        const raw = {
            [permissionKey("customers", "view")]: true,
            [permissionKey("customers", "edit")]: "true",
            [permissionKey("customers", "delete")]: "false",
        };
        assert.deepEqual(parsePermissions(raw, "CASHIER")["customers"], {
            view: true,
            edit: true,
            delete: false,
        });
    });

    it("denies anything that is not an explicit true", () => {
        for (const value of ["", "0", "yes", 1, null, undefined, {}]) {
            const raw = {
                [permissionKey("users", "view")]: value,
                [permissionKey("users", "edit")]: "true", // keeps the set "configured"
            };
            assert.equal(parsePermissions(raw, "CASHIER")["users"].view, false, `value ${String(value)}`);
        }
    });

    it("round-trips through the storage format", () => {
        const original = permissionsWith({ products: ["view", "edit"], reports: ["view"] });
        assert.deepEqual(parsePermissions(savedSettings(original), "CASHIER"), original);
    });

    it("saves one key per module and action", () => {
        const flat = flattenPermissions(defaultPermissions("CASHIER"));
        assert.equal(Object.keys(flat).length, PERMISSION_MODULES.length * PERMISSION_ACTIONS.length);
        assert.equal(flat["perm.sales.edit"], true);
        assert.equal(flat["perm.users.delete"], false);
    });
});

describe("permission model: can()", () => {
    const perms = permissionsWith({ products: ["view"], customers: ["view", "edit"] });

    it("answers from the stored set for a non-admin", () => {
        assert.equal(can(perms, "products", "view", "CASHIER"), true);
        assert.equal(can(perms, "products", "edit", "CASHIER"), false);
        assert.equal(can(perms, "customers", "edit", "CASHIER"), true);
        assert.equal(can(perms, "customers", "delete", "CASHIER"), false);
    });

    it("lets an administrator through whatever is stored", () => {
        for (const module of PERMISSION_MODULES) {
            for (const action of PERMISSION_ACTIONS) {
                assert.equal(can(perms, module, action, "ADMIN"), true);
            }
        }
    });

    it("denies when the module is missing from the set entirely", () => {
        assert.equal(can({} as never, "users", "view", "CASHIER"), false);
    });
});

describe("permission model: HTTP verb to action", () => {
    it("maps reads to view", () => {
        assert.equal(actionForMethod("GET"), "view");
        assert.equal(actionForMethod("get"), "view");
        assert.equal(actionForMethod("HEAD"), "view");
        assert.equal(actionForMethod("OPTIONS"), "view");
    });

    it("maps writes to edit", () => {
        assert.equal(actionForMethod("POST"), "edit");
        assert.equal(actionForMethod("PUT"), "edit");
        assert.equal(actionForMethod("PATCH"), "edit");
    });

    it("keeps delete separate so it can be withheld on its own", () => {
        assert.equal(actionForMethod("DELETE"), "delete");
    });

    it("treats an unrecognised verb as a write rather than a read", () => {
        assert.equal(actionForMethod("PROPFIND"), "edit");
    });
});
