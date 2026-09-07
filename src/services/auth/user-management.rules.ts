import { forbidden, invalid } from "./errors";
import { ADMIN_ROLE, USER_ROLES, type UserRoleName } from "./permission-modules";
import { isAdmin } from "./permission-rules";

/**
 * Rules for changing accounts.
 *
 * `users.edit` says you may manage staff accounts. It must not also mean you
 * may make yourself an administrator, or lock the business out of its own
 * system — so who may hold the administrator role, and who may be switched off,
 * are decided here rather than left to whoever holds the module permission.
 */

export interface Actor {
    id: number;
    role: string;
}

export interface UserChanges {
    role?: string | null;
    status?: boolean | null;
}

export const isValidRole = (role: string): role is UserRoleName =>
    (USER_ROLES as readonly string[]).includes(role);

export function assertValidRole(role: string): asserts role is UserRoleName {
    if (!isValidRole(role)) {
        throw invalid(`role must be one of: ${USER_ROLES.join(", ")}`);
    }
}

/**
 * Only an administrator may hand out the administrator role. Without this a
 * manager holding `users.edit` could create an admin account and use it.
 */
export function assertCanAssignRole(actor: Actor, role: string | null | undefined): void {
    if (!role) return;
    assertValidRole(role);
    if (role === ADMIN_ROLE && !isAdmin(actor.role)) {
        throw forbidden("Only an administrator can assign the administrator role");
    }
}

/**
 * Nobody edits their own role or switches off their own account — the first is
 * self-promotion, the second locks you out mid-shift.
 */
export function assertNoSelfEscalation(actor: Actor, targetUserId: number, changes: UserChanges): void {
    if (actor.id !== targetUserId) return;

    if (changes.role != null && changes.role !== actor.role) {
        throw forbidden("You cannot change your own role");
    }
    if (changes.status === false) {
        throw forbidden("You cannot deactivate your own account");
    }
}

export interface AdminCensus {
    /** How many active administrators exist right now. */
    activeAdmins: number;
    /** Whether the account being changed is one of them. */
    targetIsActiveAdmin: boolean;
}

/**
 * The last active administrator cannot be demoted, deactivated or deleted —
 * otherwise nobody can ever administer the system again.
 */
export function assertNotLastAdmin(census: AdminCensus, changes: UserChanges & { deleting?: boolean }): void {
    if (!census.targetIsActiveAdmin || census.activeAdmins > 1) return;

    if (changes.deleting) throw forbidden("Cannot delete the last administrator account");
    if (changes.role != null && changes.role !== ADMIN_ROLE) {
        throw forbidden("Cannot change the role of the last administrator account");
    }
    if (changes.status === false) throw forbidden("Cannot deactivate the last administrator account");
}

export function assertNotSelfDelete(actor: Actor, targetUserId: number): void {
    if (actor.id === targetUserId) throw invalid("Cannot delete your own account");
}

export function assertPasswordStrength(password: string, field = "password"): void {
    if (!password || password.length < 6) {
        throw invalid(`${field} must be at least 6 characters`);
    }
}
