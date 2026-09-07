import { prisma } from "../../prisma/prisma";
import { parsePermissions } from "./permission-rules";
import type { AccessProfile } from "./authorize-rules";

export type { AccessProfile };

/**
 * Loads a user's live role, status and permissions.
 *
 * The role is read from the database rather than trusted from the JWT: tokens
 * live for seven days, so a demoted or deactivated account would otherwise keep
 * its old powers until the token expired.
 *
 * A POS fires many requests per sale, so the result is cached briefly and
 * dropped the moment the account or its permissions change.
 */

interface CacheEntry {
    profile: AccessProfile;
    expiresAt: number;
}

const TTL_MS = Number(process.env.PERMISSION_CACHE_MS || 30_000);
const cache = new Map<number, CacheEntry>();

/** Drop one user's cached access, or the whole cache when no id is given. */
export function invalidateAccessProfile(userId?: number): void {
    if (userId === undefined) cache.clear();
    else cache.delete(userId);
}

const userSettingsPrefix = (userId: number) => `user.${userId}.`;

/** Read the flat `perm.*` settings saved for a user. */
export async function loadUserSettings(userId: number): Promise<Record<string, unknown>> {
    const prefix = userSettingsPrefix(userId);
    const rows = await prisma.setting.findMany({ where: { key: { startsWith: prefix } } });

    const map: Record<string, unknown> = {};
    for (const row of rows) {
        const key = row.key.slice(prefix.length);
        map[key] = row.type === "boolean" ? row.value === "true" : row.value;
    }
    return map;
}

/** Returns null when the user no longer exists. */
export async function getAccessProfile(userId: number): Promise<AccessProfile | null> {
    const cached = cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.profile;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, status: true },
    });
    if (!user) {
        cache.delete(userId);
        return null;
    }

    const settings = await loadUserSettings(userId);
    const profile: AccessProfile = {
        userId: user.id,
        role: user.role,
        active: user.status,
        permissions: parsePermissions(settings, user.role),
    };

    cache.set(userId, { profile, expiresAt: Date.now() + TTL_MS });
    return profile;
}
