-- Performance indexes.
--
-- PostgreSQL does not create an index for a foreign key automatically, and the
-- initial migration declared none, so every join from a child row back to its
-- parent (sale_items -> sales, product_variants -> products, and so on) was a
-- sequential scan. At two years of volume the perf benchmark measured 4 of the
-- 21 hot queries scanning `sales` end to end and 8 scanning `products`.
--
-- Names follow the Prisma convention (<table>_<cols>_idx) so a later
-- `prisma migrate diff` treats them as already present.

-- Trigram support: the product/customer/supplier search boxes all use
-- `contains` (ILIKE '%term%'), which no btree index can serve.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── products / variants ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "products_categoryId_idx"    ON "products" ("categoryId");
CREATE INDEX IF NOT EXISTS "products_brandId_idx"       ON "products" ("brandId");
CREATE INDEX IF NOT EXISTS "products_active_idx"        ON "products" ("active");
CREATE INDEX IF NOT EXISTS "products_name_idx"          ON "products" ("name");
CREATE INDEX IF NOT EXISTS "products_name_trgm_idx"     ON "products" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "product_variants_productId_idx"  ON "product_variants" ("productId");
CREATE INDEX IF NOT EXISTS "product_variants_barcode_trgm_idx"
    ON "product_variants" USING gin ("barcode" gin_trgm_ops);

-- ── sales ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "sales_createdAt_idx"        ON "sales" ("createdAt");
CREATE INDEX IF NOT EXISTS "sales_customerId_idx"       ON "sales" ("customerId");
CREATE INDEX IF NOT EXISTS "sales_userId_idx"           ON "sales" ("userId");
CREATE INDEX IF NOT EXISTS "sales_parent_sale_id_idx"   ON "sales" ("parent_sale_id");

CREATE INDEX IF NOT EXISTS "sale_items_saleId_idx"      ON "sale_items" ("saleId");
CREATE INDEX IF NOT EXISTS "sale_items_variantId_idx"   ON "sale_items" ("variantId");

CREATE INDEX IF NOT EXISTS "sale_payments_saleId_idx"    ON "sale_payments" ("saleId");
CREATE INDEX IF NOT EXISTS "sale_payments_accountId_idx" ON "sale_payments" ("accountId");

-- ── purchases ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "purchases_date_idx"              ON "purchases" ("date");
CREATE INDEX IF NOT EXISTS "purchases_supplierId_idx"        ON "purchases" ("supplierId");
CREATE INDEX IF NOT EXISTS "purchases_userId_idx"            ON "purchases" ("userId");
CREATE INDEX IF NOT EXISTS "purchases_accountId_idx"         ON "purchases" ("accountId");
CREATE INDEX IF NOT EXISTS "purchases_parent_purchase_id_idx" ON "purchases" ("parent_purchase_id");

CREATE INDEX IF NOT EXISTS "purchase_items_purchaseId_idx"   ON "purchase_items" ("purchaseId");
CREATE INDEX IF NOT EXISTS "purchase_items_productId_idx"    ON "purchase_items" ("productId");

CREATE INDEX IF NOT EXISTS "purchase_payments_purchaseId_idx" ON "purchase_payments" ("purchaseId");
CREATE INDEX IF NOT EXISTS "purchase_payments_accountId_idx"  ON "purchase_payments" ("accountId");

-- ── money movement: every one of these is summed by the account balance calc ─
CREATE INDEX IF NOT EXISTS "expenses_date_idx"                ON "expenses" ("date");
CREATE INDEX IF NOT EXISTS "expenses_accountId_idx"           ON "expenses" ("accountId");
CREATE INDEX IF NOT EXISTS "customer_payments_accountId_idx"  ON "customer_payments" ("accountId");
CREATE INDEX IF NOT EXISTS "customer_payments_customerId_idx" ON "customer_payments" ("customerId");
CREATE INDEX IF NOT EXISTS "supplier_payments_accountId_idx"  ON "supplier_payments" ("accountId");
CREATE INDEX IF NOT EXISTS "supplier_payments_supplierId_idx" ON "supplier_payments" ("supplierId");
CREATE INDEX IF NOT EXISTS "salary_slips_accountId_idx"       ON "salary_slips" ("accountId");
CREATE INDEX IF NOT EXISTS "employee_advances_accountId_idx"  ON "employee_advances" ("accountId");
CREATE INDEX IF NOT EXISTS "employee_advances_employeeId_idx" ON "employee_advances" ("employeeId");
CREATE INDEX IF NOT EXISTS "account_transfers_from_account_id_idx" ON "account_transfers" ("from_account_id");
CREATE INDEX IF NOT EXISTS "account_transfers_to_account_id_idx"   ON "account_transfers" ("to_account_id");

-- ── stock ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "stock_movements_createdAt_idx"   ON "stock_movements" ("createdAt");
CREATE INDEX IF NOT EXISTS "stock_movements_referenceId_type_idx"
    ON "stock_movements" ("referenceId", "type");
CREATE INDEX IF NOT EXISTS "stock_movements_accountId_idx"   ON "stock_movements" ("accountId");

-- ── parties: searched by name/phone from the POS ───────────────────────────
CREATE INDEX IF NOT EXISTS "customers_name_trgm_idx"  ON "customers" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "customers_phone_trgm_idx" ON "customers" USING gin ("phone" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "suppliers_name_trgm_idx"  ON "suppliers" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "suppliers_phone_trgm_idx" ON "suppliers" USING gin ("phone" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "categories_parentId_idx"  ON "categories" ("parentId");

-- ── held / bookings ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "advance_booking_items_bookingId_idx" ON "advance_booking_items" ("bookingId");
CREATE INDEX IF NOT EXISTS "advance_bookings_customerId_idx"     ON "advance_bookings" ("customerId");
CREATE INDEX IF NOT EXISTS "package_items_packageId_idx"         ON "package_items" ("packageId");

-- Fresh statistics so the planner starts using all of the above immediately
-- instead of waiting for the next autovacuum cycle.
ANALYZE;
