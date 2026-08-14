# POS performance report

Generated 2026-08-14T04:40:03.230Z

Comparing **baseline** (before changes) against **after** (after changes).

## Database query latency (p95, direct SQL)

| Query | Screen | baseline | after | Change |
|---|---|---|---|---|
| products: POS text search (page 1) | POS product search box | 24.6 ms | 9.9 ms | 2.5x faster |
| products: count for same search | POS product search box (pagination total) | 17.4 ms | 13.8 ms | 1.3x faster |
| products: variants hydrate for page | POS product search box (include: variants) | 1.9 ms | 1.6 ms | 1.2x faster |
| products: list page 1 (no filter) | Products screen | 5.4 ms | 1.9 ms | 2.8x faster |
| products: deep page (offset 5000) | Products screen, later pages | 65.1 ms | 2.5 ms | 26.0x faster |
| variant lookup by barcode | Barcode scan on POS | 0.9 ms | 1.3 ms | 1.4x slower |
| sales: list page 1 with items+customer | Sales history | 10.6 ms | 1.1 ms | 9.6x faster |
| sales: items hydrate for page | Sales history (include: items) | 54.6 ms | 1.1 ms | 49.6x faster |
| sales: payments hydrate for page | Sales history (include: payments) | 9.9 ms | 0.8 ms | 12.4x faster |
| sales: count for date range | Sales history pagination | 19.1 ms | 1.4 ms | 13.6x faster |
| dashboard: month sale aggregate | Dashboard | 26.7 ms | 3.3 ms | 8.1x faster |
| dashboard: 12-month row pull | Dashboard chart (findMany, grouped in JS) | 95.8 ms | 124.3 ms | 1.3x slower |
| dashboard: month COGS row pull | Dashboard COGS (findMany, summed in JS) | 53.7 ms | 35.4 ms | 1.5x faster |
| dashboard: top variants this month | Dashboard top sellers | 143.9 ms | 42.1 ms | 3.4x faster |
| dashboard: all active products + variant | Dashboard inventory tiles | 12.9 ms | 18.1 ms | 1.4x slower |
| report: sales in date range + joins | Sales PDF report (1 year) | 254.6 ms | 334.4 ms | 1.3x slower |
| report: sale items for date range | Detailed sales PDF (1 year) | 744.3 ms | 905.2 ms | 1.2x slower |
| report: stock movement history | Stock report | 199.2 ms | 8.3 ms | 24.0x faster |
| customer ledger statement | Customer statement PDF | 0.8 ms | 0.9 ms | 1.1x slower |
| customer balances (all) | Customer balances PDF | 26.5 ms | 35.9 ms | 1.4x slower |
| purchase items for date range | Purchases PDF report | 58.1 ms | 75.1 ms | 1.3x slower |

## Endpoint smoke test (single request, full data volume)

Failing endpoints: **2 → 0** of 27.

| Endpoint | baseline | after | Change |
|---|---|---|---|
| `/api/health` | 5.4 ms | 7.4 ms | 1.4x slower |
| `/api/products?page=1&pageSize=25` | 78.1 ms | 149.5 ms | 1.9x slower |
| `/api/products?q=rice&pageSize=20` | 31.6 ms | 45.9 ms | 1.5x slower |
| `/api/products?page=200&pageSize=25` | 51.9 ms | 29.8 ms | 1.7x faster |
| `/api/products?lowStock=true&pageSize=25` | 18.1 ms | 19.4 ms | 1.1x slower |
| `/api/categories?pageSize=200` | 14.1 ms | 15.2 ms | 1.1x slower |
| `/api/brands?pageSize=200` | 9.7 ms | 13.9 ms | 1.4x slower |
| `/api/accounts?pageSize=100` | 146 ms | 232.2 ms | 1.6x slower |
| `/api/customers?pageSize=25` | 30.1 ms | 62.3 ms | 2.1x slower |
| `/api/customers?q=Perf&pageSize=10` | 23 ms | 39.5 ms | 1.7x slower |
| `/api/suppliers?pageSize=25` | 16.8 ms | 22.8 ms | 1.4x slower |
| `/api/users?pageSize=50` | 7.8 ms | 14.8 ms | 1.9x slower |
| `/api/sales?page=1&pageSize=15` | 70.9 ms | 28.2 ms | 2.5x faster |
| `/api/sales?page=1&pageSize=15&q=Perf` | HTTP 500 | 508.2 ms | fixed |
| `/api/sales?page=1&pageSize=15&from=2025-08-14&to=2026-08-14` | 77.9 ms | 59.1 ms | 1.3x faster |
| `/api/sales?page=1&pageSize=15&type=RETURN` | 17.2 ms | 21.8 ms | 1.3x slower |
| `/api/purchases?page=1&pageSize=15` | 14.1 ms | 34.8 ms | 2.5x slower |
| `/api/purchases?page=1&pageSize=15&q=PO` | HTTP 500 | 35.4 ms | fixed |
| `/api/expenses?page=1&pageSize=25` | 12.5 ms | 15.8 ms | 1.3x slower |
| `/api/stock-movements?page=1&pageSize=25` | 93.1 ms | 45.5 ms | 2.0x faster |
| `/api/held/sales?pageSize=50` | 8.7 ms | 9.8 ms | 1.1x slower |
| `/api/promotions?pageSize=25` | 12.7 ms | 23.5 ms | 1.9x slower |
| `/api/advance-bookings?pageSize=15` | 14 ms | 16.8 ms | 1.2x slower |
| `/api/employees?pageSize=25` | 6.7 ms | 10.3 ms | 1.5x slower |
| `/api/tax-schedules?pageSize=100` | 6.5 ms | 12.2 ms | 1.9x slower |
| `/api/settings` | 1.8 ms | 2.7 ms | 1.5x slower |
| `/api/reports/dashboard` | 429.3 ms | 345.9 ms | 1.2x faster |

## HTTP load test (fixed concurrency)

| Scenario | Conc | p95 baseline | p95 after | req/s | Change |
|---|---|---|---|---|---|
| health | 20 | 12.2 ms | 11.3 ms | 4034.2 → 3937.8 | 1.1x faster |
| product search (typing) | 10 | 217.6 ms | 80.8 ms | 90.3 → 147.9 | 2.7x faster |
| product search (longer term) | 10 | 249 ms | 68.5 ms | 49.7 → 172.4 | 3.6x faster |
| barcode lookup | 10 | 73.6 ms | 50 ms | 179.3 → 280.8 | 1.5x faster |
| products list page 1 | 8 | 90.4 ms | 66.1 ms | 130.3 → 177.4 | 1.4x faster |
| products list deep page | 4 | 141.4 ms | 31.1 ms | 34.5 → 187.5 | 4.5x faster |
| categories list | 8 | 25.8 ms | 34.3 ms | 444.6 → 351.9 | 1.3x slower |
| brands list | 8 | 37.3 ms | 49.2 ms | 303.8 → 226 | 1.3x slower |
| accounts list | 8 | 119 ms | 107.7 ms | 91.2 → 113.5 | 1.1x faster |
| customers search | 8 | 81.7 ms | 88 ms | 135.8 → 132.7 | 1.1x slower |
| sales history page 1 | 8 | 269.5 ms | 71.8 ms | 35.8 → 186.5 | 3.8x faster |
| dashboard | 4 | 1790.1 ms | 398.7 ms | 2.6 → 14.9 | 4.5x faster |

## Stress ramp — concurrency at which latency leaves budget

| Scenario | knee baseline | knee after | peak req/s baseline | peak req/s after |
|---|---|---|---|---|
| product search (longer term) | 20 concurrent | 40 concurrent | 61.9 | 166.1 |
| barcode lookup | 80 concurrent | 80 concurrent | 223.1 | 259 |
| sales history page 1 | 40 concurrent | not reached | 43.8 | 212.5 |
| dashboard | 10 concurrent | 40 concurrent | 2.8 | 17.2 |
