import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    assertCanAssignRole,
    assertNoSelfEscalation,
    assertNotLastAdmin,
    assertNotSelfDelete,
    assertPasswordStrength,
    assertValidRole,
    isValidRole,
    type Actor,
} from "../user-management.rules";
import { USER_ROLES } from "../permission-modules";

const admin: Actor = { id: 1, role: "ADMIN" };
const manager: Actor = { id: 2, role: "MANAGER" };
const cashier: Actor = { id: 3, role: "CASHIER" };

/** Run `fn` and return the thrown message, or null if it did not throw. */
function errorFrom(fn: () => unknown): string | null {
    try {
        fn();
        return null;
    } catch (e) {
        return (e as Error).message;
    }
}

function statusFrom(fn: () => unknown): number | null {
    try {
        fn();
        return null;
    } catch (e) {
        return (e as { status?: number }).status ?? null;
    }
}

describe("roles: the allowed set", () => {
    it("accepts every role the schema defines", () => {
        for (const role of USER_ROLES) {
            assert.equal(isValidRole(role), true, role);
            assert.doesNotThrow(() => assertValidRole(role));
        }
    });

    it("rejects anything else, case included", () => {
        for (const bad of ["OWNER", "admin", "Admin", "", "SUPERUSER"]) {
            assert.equal(isValidRole(bad), false, bad);
            assert.match(String(errorFrom(() => assertValidRole(bad))), /role must be one of/);
        }
    });

    it("answers 400 for an unknown role, not 403", () => {
        assert.equal(statusFrom(() => assertValidRole("OWNER")), 400);
    });
});

describe("roles: only an administrator may create an administrator", () => {
    it("lets an administrator assign any role", () => {
        for (const role of USER_ROLES) {
            assert.doesNotThrow(() => assertCanAssignRole(admin, role));
        }
    });

    it("stops a manager with users.edit from minting an admin", () => {
        const err = errorFrom(() => assertCanAssignRole(manager, "ADMIN"));
        assert.match(String(err), /Only an administrator can assign the administrator role/);
        assert.equal(statusFrom(() => assertCanAssignRole(manager, "ADMIN")), 403);
    });

    it("still lets that manager create ordinary staff", () => {
        for (const role of ["MANAGER", "CASHIER", "DELIVERY_BOY", "WORKER"]) {
            assert.doesNotThrow(() => assertCanAssignRole(manager, role));
        }
    });

    it("ignores an absent role — not every update changes it", () => {
        assert.doesNotThrow(() => assertCanAssignRole(cashier, null));
        assert.doesNotThrow(() => assertCanAssignRole(cashier, undefined));
    });

    it("validates the role before deciding who may assign it", () => {
        assert.match(String(errorFrom(() => assertCanAssignRole(admin, "OWNER"))), /role must be one of/);
    });
});

describe("accounts: nobody escalates or locks out themselves", () => {
    it("refuses a self role change", () => {
        const err = errorFrom(() => assertNoSelfEscalation(cashier, cashier.id, { role: "ADMIN" }));
        assert.match(String(err), /cannot change your own role/);
    });

    it("refuses even an administrator changing their own role", () => {
        assert.match(
            String(errorFrom(() => assertNoSelfEscalation(admin, admin.id, { role: "CASHIER" }))),
            /cannot change your own role/
        );
    });

    it("refuses deactivating your own account", () => {
        assert.match(
            String(errorFrom(() => assertNoSelfEscalation(admin, admin.id, { status: false }))),
            /cannot deactivate your own account/
        );
    });

    it("allows editing your own name, or re-stating your existing role", () => {
        assert.doesNotThrow(() => assertNoSelfEscalation(cashier, cashier.id, {}));
        assert.doesNotThrow(() => assertNoSelfEscalation(cashier, cashier.id, { role: "CASHIER" }));
        assert.doesNotThrow(() => assertNoSelfEscalation(cashier, cashier.id, { status: true }));
    });

    it("does not interfere with editing somebody else", () => {
        assert.doesNotThrow(() => assertNoSelfEscalation(admin, 42, { role: "ADMIN", status: false }));
    });

    it("refuses deleting your own account", () => {
        assert.match(String(errorFrom(() => assertNotSelfDelete(admin, admin.id))), /Cannot delete your own account/);
        assert.doesNotThrow(() => assertNotSelfDelete(admin, 42));
    });
});

describe("accounts: the last administrator cannot be removed", () => {
    const lastAdmin = { activeAdmins: 1, targetIsActiveAdmin: true };
    const oneOfTwo = { activeAdmins: 2, targetIsActiveAdmin: true };
    const notAnAdmin = { activeAdmins: 1, targetIsActiveAdmin: false };

    it("blocks deleting them", () => {
        assert.match(
            String(errorFrom(() => assertNotLastAdmin(lastAdmin, { deleting: true }))),
            /Cannot delete the last administrator/
        );
    });

    it("blocks demoting them", () => {
        assert.match(
            String(errorFrom(() => assertNotLastAdmin(lastAdmin, { role: "MANAGER" }))),
            /Cannot change the role of the last administrator/
        );
    });

    it("blocks deactivating them", () => {
        assert.match(
            String(errorFrom(() => assertNotLastAdmin(lastAdmin, { status: false }))),
            /Cannot deactivate the last administrator/
        );
    });

    it("allows editing them in ways that keep them an active admin", () => {
        assert.doesNotThrow(() => assertNotLastAdmin(lastAdmin, {}));
        assert.doesNotThrow(() => assertNotLastAdmin(lastAdmin, { role: "ADMIN" }));
        assert.doesNotThrow(() => assertNotLastAdmin(lastAdmin, { status: true }));
    });

    it("steps aside once a second administrator exists", () => {
        assert.doesNotThrow(() => assertNotLastAdmin(oneOfTwo, { deleting: true }));
        assert.doesNotThrow(() => assertNotLastAdmin(oneOfTwo, { role: "CASHIER" }));
        assert.doesNotThrow(() => assertNotLastAdmin(oneOfTwo, { status: false }));
    });

    it("does not apply to a non-admin account", () => {
        assert.doesNotThrow(() => assertNotLastAdmin(notAnAdmin, { deleting: true }));
    });
});

describe("passwords", () => {
    it("requires at least six characters", () => {
        assert.match(String(errorFrom(() => assertPasswordStrength("12345"))), /at least 6 characters/);
        assert.doesNotThrow(() => assertPasswordStrength("123456"));
    });

    it("rejects an empty or missing password", () => {
        assert.match(String(errorFrom(() => assertPasswordStrength(""))), /at least 6 characters/);
        assert.match(
            String(errorFrom(() => assertPasswordStrength(undefined as unknown as string))),
            /at least 6 characters/
        );
    });

    it("names the field it is complaining about", () => {
        assert.match(
            String(errorFrom(() => assertPasswordStrength("123", "newPassword"))),
            /newPassword must be at least 6 characters/
        );
    });

    it("answers 400 rather than 403", () => {
        assert.equal(statusFrom(() => assertPasswordStrength("123")), 400);
    });
});
