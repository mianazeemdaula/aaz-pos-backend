import type { Requirement } from "./authorize-rules";

/**
 * Shared read grants.
 *
 * Permissions are handed out per screen, but the transactional screens need
 * reference data they do not own — the till cannot ring up a sale without
 * reading products, payment accounts and customers, and the purchase desk needs
 * the same plus suppliers. A default cashier holds `sales.edit` and nothing
 * else, so without these the till would be unusable for everyone but an admin.
 *
 * These widen READS only. Creating or deleting a product, an account or a
 * customer always needs that module's own permission.
 */
export const TRANSACTING: readonly Requirement[] = [
    { module: "sales", action: "edit" },
    { module: "sale-history", action: "view" },
    { module: "purchases", action: "edit" },
    { module: "purchase-history", action: "view" },
    { module: "advance-bookings", action: "edit" },
    { module: "returns", action: "view" },
];

/** Reference data any transacting screen may read. */
export const CATALOGUE_READERS = TRANSACTING;

/** Whoever can see the dashboard may read the figures behind it. */
export const DASHBOARD_READERS: readonly Requirement[] = [{ module: "dashboard", action: "view" }];
