# POS Backend — API Documentation

**Base URL:** `http://localhost:{PORT}/api`

**Authentication:**  
All routes except `POST /auth/register` and `POST /auth/login` require a Bearer token in the `Authorization` header:
```
Authorization: Bearer <token>
```

**Pagination Query Params (common to all list endpoints):**

| Param      | Type     | Default | Description                        |
|------------|----------|---------|------------------------------------|
| `page`     | `number` | `1`     | Page number                        |
| `pageSize` | `number` | `10`    | Items per page (max 100)           |
| `q`        | `string` | —       | Search keyword (where applicable)  |

**Paginated Response Shape:**
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 100,
    "totalPages": 10,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

---

## Table of Contents

1. [Auth](#1-auth)
2. [Users](#2-users)
3. [Accounts](#3-accounts)
4. [Customers](#4-customers)
5. [Suppliers](#5-suppliers)
6. [Categories](#6-categories)
7. [Brands](#7-brands)
8. [Products](#8-products)
9. [Stock Movements](#9-stock-movements)
10. [Sales](#10-sales)
11. [Purchases](#11-purchases)
12. [Packages](#12-packages)
13. [Employees](#13-employees)
14. [Salary Slips](#14-salary-slips)
15. [Expenses](#15-expenses)
16. [Recurring Expenses](#16-recurring-expenses)
17. [Advance Bookings](#17-advance-bookings)
18. [Promotions](#18-promotions)
19. [Held Transactions](#19-held-transactions)
20. [Reports](#20-reports) · [PDF Reports](#pdf-reports)

---

## 1. Auth

### Register
```
Method:   POST
URL:      /api/auth/register
Auth:     None
```
**req_body:**
```json
{
  "name":     "string (required)",
  "username": "string (required)",
  "password": "string (required, min 6 chars)",
  "role":     "ADMIN | MANAGER | CASHIER | DELIVERY_BOY | WORKER (required)",
  "phone":    "string (optional)",
  "address":  "string (optional)"
}
```
**response:** `201`
```json
{
  "token": "string (JWT, 7-day expiry)",
  "user": {
    "id": "number",
    "name": "string",
    "username": "string",
    "role": "string",
    "createdAt": "ISO date"
  }
}
```

---

### Login
```
Method:   POST
URL:      /api/auth/login
Auth:     None
```
**req_body:**
```json
{
  "username": "string (required)",
  "password": "string (required)"
}
```
**response:** `200`
```json
{
  "token": "string (JWT, 7-day expiry)",
  "user": {
    "id": "number",
    "name": "string",
    "username": "string",
    "role": "string",
    "lastLogin": "ISO date"
  }
}
```

---

### Get Current User (Me)
```
Method:   GET
URL:      /api/auth/me
Auth:     Required
```
**req_param:** None  
**req_body:** None  
**response:** `200`
```json
{
  "id": "number",
  "name": "string",
  "username": "string",
  "role": "string",
  "phone": "string | null",
  "address": "string | null",
  "status": "boolean",
  "createdAt": "ISO date",
  "lastLogin": "ISO date | null"
}
```

---

### Change Password
```
Method:   POST
URL:      /api/auth/change-password
Auth:     Required
```
**req_body:**
```json
{
  "currentPassword": "string (required)",
  "newPassword":     "string (required, min 6 chars)"
}
```
**response:** `200`
```json
{ "message": "Password changed successfully" }
```

---

## 2. Users

### List Users
```
Method:   GET
URL:      /api/users
Auth:     Required
```
**req_param (query):**

| Param    | Type      | Description                                      |
|----------|-----------|--------------------------------------------------|
| `page`   | `number`  | Page number                                      |
| `pageSize`| `number` | Items per page                                   |
| `q`      | `string`  | Search by name or username                       |
| `role`   | `string`  | Filter by role: `ADMIN \| MANAGER \| CASHIER \| DELIVERY_BOY \| WORKER` |
| `status` | `boolean` | Filter by status: `true` or `false`              |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "name": "string",
      "username": "string",
      "role": "string",
      "phone": "string | null",
      "address": "string | null",
      "status": "boolean",
      "createdAt": "ISO date",
      "lastLogin": "ISO date | null"
    }
  ],
  "pagination": { ... }
}
```

---

### Get User
```
Method:   GET
URL:      /api/users/:id
Auth:     Required
```
**req_param:** `id` — User ID (number)  
**response:** `200`
```json
{
  "id": "number",
  "name": "string",
  "username": "string",
  "role": "string",
  "phone": "string | null",
  "address": "string | null",
  "status": "boolean",
  "createdAt": "ISO date",
  "updatedAt": "ISO date",
  "lastLogin": "ISO date | null"
}
```

---

### Create User
```
Method:   POST
URL:      /api/users
Auth:     Required
```
**req_body:**
```json
{
  "name":     "string (required)",
  "username": "string (required)",
  "password": "string (required, min 6 chars)",
  "role":     "ADMIN | MANAGER | CASHIER | DELIVERY_BOY | WORKER (required)",
  "phone":    "string (optional)",
  "address":  "string (optional)"
}
```
**response:** `201`
```json
{
  "id": "number",
  "name": "string",
  "username": "string",
  "role": "string",
  "phone": "string | null",
  "address": "string | null",
  "status": "boolean",
  "createdAt": "ISO date"
}
```

---

### Update User
```
Method:   PUT
URL:      /api/users/:id
Auth:     Required
```
**req_param:** `id` — User ID (number)  
**req_body:** (all fields optional)
```json
{
  "name":     "string",
  "username": "string",
  "role":     "ADMIN | MANAGER | CASHIER | DELIVERY_BOY | WORKER",
  "phone":    "string",
  "address":  "string",
  "status":   "boolean"
}
```
**response:** `200`
```json
{
  "id": "number",
  "name": "string",
  "username": "string",
  "role": "string",
  "phone": "string | null",
  "address": "string | null",
  "status": "boolean",
  "updatedAt": "ISO date"
}
```

---

### Reset User Password
```
Method:   POST
URL:      /api/users/:id/reset-password
Auth:     Required
```
**req_param:** `id` — User ID (number)  
**req_body:**
```json
{
  "newPassword": "string (required, min 6 chars)"
}
```
**response:** `200`
```json
{ "message": "Password reset successfully" }
```

---

### Delete User
```
Method:   DELETE
URL:      /api/users/:id
Auth:     Required
```
**req_param:** `id` — User ID (number)  
**response:** `200`
```json
{ "message": "User deleted" }
```
> Note: Cannot delete your own logged-in account.

---

## 3. Accounts

Represents the chart of accounts (Cash, Bank, etc.)

### List Accounts
```
Method:   GET
URL:      /api/accounts
Auth:     Required
```
**req_param (query):**

| Param    | Type      | Description                                           |
|----------|-----------|-------------------------------------------------------|
| `page`   | `number`  | Page number                                           |
| `pageSize`| `number` | Items per page                                        |
| `q`      | `string`  | Search by name or code                                |
| `type`   | `string`  | Filter: `ASSET \| LIABILITY \| EQUITY \| INCOME \| EXPENSE` |
| `active` | `boolean` | Filter by active status: `true` or `false`            |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "code": "string",
      "name": "string",
      "type": "ASSET | LIABILITY | EQUITY | INCOME | EXPENSE",
      "active": "boolean",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Get Account
```
Method:   GET
URL:      /api/accounts/:id
Auth:     Required
```
**req_param:** `id` — Account ID (number)  
**response:** `200` — Single account object

---

### Create Account
```
Method:   POST
URL:      /api/accounts
Auth:     Required
```
**req_body:**
```json
{
  "code":   "string (required, unique)",
  "name":   "string (required)",
  "type":   "ASSET | LIABILITY | EQUITY | INCOME | EXPENSE (required)",
  "active": "boolean (optional, default true)"
}
```
**response:** `201` — Created account object

---

### Update Account
```
Method:   PUT
URL:      /api/accounts/:id
Auth:     Required
```
**req_param:** `id` — Account ID (number)  
**req_body:** (all fields optional)
```json
{
  "code":   "string",
  "name":   "string",
  "type":   "ASSET | LIABILITY | EQUITY | INCOME | EXPENSE",
  "active": "boolean"
}
```
**response:** `200` — Updated account object

---

### Delete Account
```
Method:   DELETE
URL:      /api/accounts/:id
Auth:     Required
```
**req_param:** `id` — Account ID (number)  
**response:** `200`
```json
{ "message": "Account deleted" }
```

---

## 4. Customers

### List Customers
```
Method:   GET
URL:      /api/customers
Auth:     Required
```
**req_param (query):**

| Param    | Type      | Description                                  |
|----------|-----------|----------------------------------------------|
| `page`   | `number`  |                                              |
| `pageSize`| `number` |                                              |
| `q`      | `string`  | Search by name, phone, or email              |
| `active` | `boolean` | Filter: `true` or `false`                    |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "name": "string",
      "phone": "string | null",
      "email": "string | null",
      "address": "string | null",
      "creditLimit": "number",
      "balance": "number",
      "active": "boolean",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Get Customer
```
Method:   GET
URL:      /api/customers/:id
Auth:     Required
```
**req_param:** `id` — Customer ID (number)  
**response:** `200`
```json
{
  "id": "number",
  "name": "string",
  "phone": "string | null",
  "email": "string | null",
  "address": "string | null",
  "creditLimit": "number",
  "balance": "number",
  "active": "boolean",
  "createdAt": "ISO date",
  "ledger": [ ...last 20 ledger entries ],
  "payments": [ ...last 10 payments ]
}
```

---

### Create Customer
```
Method:   POST
URL:      /api/customers
Auth:     Required
```
**req_body:**
```json
{
  "name":        "string (required)",
  "phone":       "string (optional)",
  "address":     "string (optional)",
  "email":       "string (optional)",
  "creditLimit": "number (optional, default 0)"
}
```
**response:** `201` — Created customer object

---

### Update Customer
```
Method:   PUT
URL:      /api/customers/:id
Auth:     Required
```
**req_param:** `id` — Customer ID (number)  
**req_body:** (all optional)
```json
{
  "name":        "string",
  "phone":       "string",
  "address":     "string",
  "email":       "string",
  "creditLimit": "number",
  "active":      "boolean"
}
```
**response:** `200` — Updated customer object

---

### Delete Customer
```
Method:   DELETE
URL:      /api/customers/:id
Auth:     Required
```
**req_param:** `id` — Customer ID (number)  
**response:** `200`
```json
{ "message": "Customer deleted" }
```

---

### List Customer Ledger
```
Method:   GET
URL:      /api/customers/:id/ledger
Auth:     Required
```
**req_param:** `id` — Customer ID (number)  
**req_param (query):** `page`, `pageSize`  
**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "customerId": "number",
      "type": "SALE | PAYMENT | SALE_RETURN | REFUND | ADJUSTMENT_DR | ADJUSTMENT_CR | OPENING_BALANCE",
      "amount": "number",
      "balance": "number (running balance after this entry)",
      "note": "string | null",
      "reference": "string | null",
      "referenceId": "number | null",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Create Customer Ledger Entry
```
Method:   POST
URL:      /api/customers/:id/ledger
Auth:     Required
```
**req_param:** `id` — Customer ID (number)  
**req_body:**
```json
{
  "type":        "SALE | PAYMENT | SALE_RETURN | REFUND | ADJUSTMENT_DR | ADJUSTMENT_CR | OPENING_BALANCE (required)",
  "amount":      "number (required, positive)",
  "note":        "string (optional)",
  "reference":   "string (optional)",
  "referenceId": "number (optional)"
}
```
**response:** `201` — Created ledger entry  
> Note: CREDIT types (PAYMENT, SALE_RETURN, REFUND, ADJUSTMENT_CR) decrease the customer balance. DEBIT types increase it.

---

### List Customer Payments
```
Method:   GET
URL:      /api/customers/:id/payments
Auth:     Required
```
**req_param:** `id` — Customer ID (number)  
**req_param (query):** `page`, `pageSize`  
**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "customerId": "number",
      "amount": "number",
      "accountId": "number",
      "account": { "id": "number", "name": "string", "code": "string" },
      "note": "string | null",
      "date": "ISO date",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Create Customer Payment
```
Method:   POST
URL:      /api/customers/:id/payments
Auth:     Required
```
**req_param:** `id` — Customer ID (number)  
**req_body:**
```json
{
  "amount":    "number (required, positive)",
  "accountId": "number (required — account receiving payment)",
  "note":      "string (optional)",
  "date":      "ISO date string (optional, defaults to now)"
}
```
**response:** `201` — Created payment with account details  
> Side effects: Decreases customer balance, creates a `PAYMENT` ledger entry automatically.

---

## 5. Suppliers

### List Suppliers
```
Method:   GET
URL:      /api/suppliers
Auth:     Required
```
**req_param (query):**

| Param    | Type      | Description                     |
|----------|-----------|---------------------------------|
| `page`   | `number`  |                                 |
| `pageSize`| `number` |                                 |
| `q`      | `string`  | Search by name, phone, or email |
| `active` | `boolean` | Filter: `true` or `false`       |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "name": "string",
      "phone": "string | null",
      "email": "string | null",
      "address": "string | null",
      "bankDetails": "string | null",
      "paymentTerms": "string | null",
      "taxId": "string | null",
      "balance": "number",
      "active": "boolean",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Get Supplier
```
Method:   GET
URL:      /api/suppliers/:id
Auth:     Required
```
**req_param:** `id` — Supplier ID (number)  
**response:** `200` — Supplier object with last 20 ledger entries and last 10 payments

---

### Create Supplier
```
Method:   POST
URL:      /api/suppliers
Auth:     Required
```
**req_body:**
```json
{
  "name":         "string (required)",
  "phone":        "string (optional)",
  "address":      "string (optional)",
  "email":        "string (optional)",
  "bankDetails":  "string (optional)",
  "paymentTerms": "string (optional)",
  "taxId":        "string (optional)"
}
```
**response:** `201` — Created supplier object

---

### Update Supplier
```
Method:   PUT
URL:      /api/suppliers/:id
Auth:     Required
```
**req_param:** `id` — Supplier ID (number)  
**req_body:** (all optional)
```json
{
  "name":         "string",
  "phone":        "string",
  "address":      "string",
  "email":        "string",
  "bankDetails":  "string",
  "paymentTerms": "string",
  "taxId":        "string",
  "active":       "boolean"
}
```
**response:** `200` — Updated supplier object

---

### Delete Supplier
```
Method:   DELETE
URL:      /api/suppliers/:id
Auth:     Required
```
**req_param:** `id` — Supplier ID (number)  
**response:** `200`
```json
{ "message": "Supplier deleted" }
```

---

### List Supplier Ledger
```
Method:   GET
URL:      /api/suppliers/:id/ledger
Auth:     Required
```
**req_param:** `id` — Supplier ID (number)  
**req_param (query):** `page`, `pageSize`  
**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "supplierId": "number",
      "type": "PURCHASE | PAYMENT | PURCHASE_RETURN | ADJUSTMENT_DR | ADJUSTMENT_CR | OPENING_BALANCE",
      "amount": "number",
      "balance": "number",
      "note": "string | null",
      "reference": "string | null",
      "referenceId": "number | null",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Create Supplier Ledger Entry
```
Method:   POST
URL:      /api/suppliers/:id/ledger
Auth:     Required
```
**req_param:** `id` — Supplier ID (number)  
**req_body:**
```json
{
  "type":        "PURCHASE | PAYMENT | PURCHASE_RETURN | ADJUSTMENT_DR | ADJUSTMENT_CR | OPENING_BALANCE (required)",
  "amount":      "number (required, positive)",
  "note":        "string (optional)",
  "reference":   "string (optional)",
  "referenceId": "number (optional)"
}
```
**response:** `201` — Created ledger entry  
> Note: CREDIT types (PAYMENT, PURCHASE_RETURN, ADJUSTMENT_CR) decrease the supplier balance.

---

### List Supplier Payments
```
Method:   GET
URL:      /api/suppliers/:id/payments
Auth:     Required
```
**req_param:** `id` — Supplier ID (number)  
**req_param (query):** `page`, `pageSize`  
**response:** `200` — Paginated list (same shape as customer payments)

---

### Create Supplier Payment
```
Method:   POST
URL:      /api/suppliers/:id/payments
Auth:     Required
```
**req_param:** `id` — Supplier ID (number)  
**req_body:**
```json
{
  "amount":    "number (required, positive)",
  "accountId": "number (required — account paying from)",
  "note":      "string (optional)",
  "date":      "ISO date string (optional, defaults to now)"
}
```
**response:** `201` — Created payment  
> Side effects: Decreases supplier balance, creates a `PAYMENT` ledger entry automatically.

---

## 6. Categories

### List Categories
```
Method:   GET
URL:      /api/categories
Auth:     Required
```
**req_param (query):**

| Param      | Type              | Description                               |
|------------|-------------------|-------------------------------------------|
| `q`        | `string`          | Search by name                            |
| `parentId` | `number \| "null"` | Filter by parent (`"null"` = root only)  |

**response:** `200` — Array (not paginated)
```json
[
  {
    "id": "number",
    "name": "string",
    "parentId": "number | null",
    "hsnCode": "string | null",
    "taxRate": "number | null",
    "createdAt": "ISO date",
    "subcategories": [ ...Category ]
  }
]
```

---

### Get Category
```
Method:   GET
URL:      /api/categories/:id
Auth:     Required
```
**req_param:** `id` — Category ID (number)  
**response:** `200` — Category with `subcategories` and `parent` included

---

### Create Category
```
Method:   POST
URL:      /api/categories
Auth:     Required
```
**req_body:**
```json
{
  "name":     "string (required)",
  "parentId": "number (optional — ID of parent category)",
  "hsnCode":  "string (optional)",
  "taxRate":  "number (optional)"
}
```
**response:** `201` — Created category object

---

### Update Category
```
Method:   PUT
URL:      /api/categories/:id
Auth:     Required
```
**req_param:** `id` — Category ID (number)  
**req_body:** (all optional)
```json
{
  "name":     "string",
  "parentId": "number | null",
  "hsnCode":  "string",
  "taxRate":  "number"
}
```
**response:** `200` — Updated category object

---

### Delete Category
```
Method:   DELETE
URL:      /api/categories/:id
Auth:     Required
```
**req_param:** `id` — Category ID (number)  
**response:** `200`
```json
{ "message": "Category deleted" }
```

---

## 7. Brands

### List Brands
```
Method:   GET
URL:      /api/brands
Auth:     Required
```
**req_param (query):**

| Param    | Type      | Description               |
|----------|-----------|---------------------------|
| `page`   | `number`  |                           |
| `pageSize`| `number` |                           |
| `q`      | `string`  | Search by name            |
| `active` | `boolean` | Filter: `true` or `false` |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "name": "string",
      "active": "boolean",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Get Brand
```
Method:   GET
URL:      /api/brands/:id
Auth:     Required
```
**req_param:** `id` — Brand ID (number)  
**response:** `200` — Single brand object

---

### Create Brand
```
Method:   POST
URL:      /api/brands
Auth:     Required
```
**req_body:**
```json
{
  "name":   "string (required, unique)",
  "active": "boolean (optional, default true)"
}
```
**response:** `201` — Created brand object

---

### Update Brand
```
Method:   PUT
URL:      /api/brands/:id
Auth:     Required
```
**req_param:** `id` — Brand ID (number)  
**req_body:** (all optional)
```json
{
  "name":   "string",
  "active": "boolean"
}
```
**response:** `200` — Updated brand object

---

### Delete Brand
```
Method:   DELETE
URL:      /api/brands/:id
Auth:     Required
```
**req_param:** `id` — Brand ID (number)  
**response:** `200`
```json
{ "message": "Brand deleted" }
```

---

## 8. Products

### Get Variant by Barcode
```
Method:   GET
URL:      /api/products/variants/barcode/:barcode
Auth:     Required
```
**req_param:** `barcode` — Barcode string  
**response:** `200`
```json
{
  "id": "number",
  "productId": "number",
  "name": "string",
  "barcode": "string",
  "price": "number",
  "wholesalePrice": "number | null",
  "purchasePrice": "number",
  "factor": "number",
  "isDefault": "boolean",
  "stock": "number",
  "product": {
    "id": "number",
    "name": "string",
    "totalStock": "number",
    "allowNegative": "boolean",
    "avgCostPrice": "number",
    "category": { ... },
    "brand": { ... }
  }
}
```

---

### List Products
```
Method:   GET
URL:      /api/products
Auth:     Required
```
**req_param (query):**

| Param        | Type      | Description                     |
|--------------|-----------|---------------------------------|
| `page`       | `number`  |                                 |
| `pageSize`   | `number`  |                                 |
| `q`          | `string`  | Search by name or description   |
| `categoryId` | `number`  | Filter by category              |
| `brandId`    | `number`  | Filter by brand                 |
| `active`     | `boolean` | Filter by active status         |
| `lowStock`   | `"true"`  | Filter products with low stock  |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "name": "string",
      "description": "string | null",
      "categoryId": "number",
      "brandId": "number | null",
      "totalStock": "number",
      "avgCostPrice": "number",
      "reorderLevel": "number",
      "allowNegative": "boolean",
      "imageUrl": "string | null",
      "hsCode": "string | null",
      "taxRate": "number | null",
      "active": "boolean",
      "createdAt": "ISO date",
      "brand": { ... },
      "category": { ... },
      "variants": [ ...ProductVariant ]
    }
  ],
  "pagination": { ... }
}
```

---

### Get Product
```
Method:   GET
URL:      /api/products/:id
Auth:     Required
```
**req_param:** `id` — Product ID (number)  
**response:** `200` — Product with brand, category, variants, and last 20 stock movements

---

### Create Product
```
Method:   POST
URL:      /api/products
Auth:     Required
```
**req_body:**
```json
{
  "name":          "string (required)",
  "categoryId":    "number (required)",
  "description":   "string (optional)",
  "brandId":       "number (optional)",
  "reorderLevel":  "number (optional, default 0)",
  "allowNegative": "boolean (optional, default false)",
  "imageUrl":      "string (optional)",
  "hsCode":        "string (optional)",
  "taxRate":       "number (optional)",
  "active":        "boolean (optional, default true)",
  "variants": [
    {
      "name":           "string (required)",
      "barcode":        "string (required, unique)",
      "price":          "number (required — retail price)",
      "purchasePrice":  "number (required)",
      "wholesalePrice": "number (optional)",
      "factor":         "number (optional, default 1)",
      "isDefault":      "boolean (optional, default false)"
    }
  ]
}
```
**response:** `201` — Product with brand, category, and variants

---

### Update Product
```
Method:   PUT
URL:      /api/products/:id
Auth:     Required
```
**req_param:** `id` — Product ID (number)  
**req_body:** (all optional — does NOT update variants; manage variants separately)
```json
{
  "name":          "string",
  "description":   "string",
  "brandId":       "number",
  "categoryId":    "number",
  "reorderLevel":  "number",
  "allowNegative": "boolean",
  "imageUrl":      "string",
  "hsCode":        "string",
  "taxRate":       "number",
  "active":        "boolean"
}
```
**response:** `200` — Updated product with brand, category, variants

---

### Delete Product
```
Method:   DELETE
URL:      /api/products/:id
Auth:     Required
```
**req_param:** `id` — Product ID (number)  
**response:** `200`
```json
{ "message": "Product deleted" }
```

---

### List Product Variants
```
Method:   GET
URL:      /api/products/:id/variants
Auth:     Required
```
**req_param:** `id` — Product ID (number)  
**response:** `200` — Array of variants (default variant first)
```json
[
  {
    "id": "number",
    "productId": "number",
    "name": "string",
    "barcode": "string",
    "price": "number",
    "wholesalePrice": "number | null",
    "purchasePrice": "number",
    "factor": "number",
    "isDefault": "boolean",
    "stock": "number",
    "createdAt": "ISO date"
  }
]
```

---

### Get Product Variant
```
Method:   GET
URL:      /api/products/:id/variants/:variantId
Auth:     Required
```
**req_param:** `id` — Product ID, `variantId` — Variant ID (number)  
**response:** `200` — Single variant object

---

### Create Product Variant
```
Method:   POST
URL:      /api/products/:id/variants
Auth:     Required
```
**req_param:** `id` — Product ID (number)  
**req_body:**
```json
{
  "name":           "string (required)",
  "barcode":        "string (required, unique)",
  "price":          "number (required — retail price)",
  "purchasePrice":  "number (required)",
  "wholesalePrice": "number (optional)",
  "factor":         "number (optional, default 1)",
  "isDefault":      "boolean (optional, default false)"
}
```
**response:** `201` — Created variant object

---

### Update Product Variant
```
Method:   PUT
URL:      /api/products/:id/variants/:variantId
Auth:     Required
```
**req_param:** `id` — Product ID, `variantId` — Variant ID (number)  
**req_body:** (all optional)
```json
{
  "name":           "string",
  "barcode":        "string",
  "price":          "number",
  "purchasePrice":  "number",
  "wholesalePrice": "number",
  "factor":         "number",
  "isDefault":      "boolean"
}
```
**response:** `200` — Updated variant object

---

### Delete Product Variant
```
Method:   DELETE
URL:      /api/products/:id/variants/:variantId
Auth:     Required
```
**req_param:** `id` — Product ID, `variantId` — Variant ID (number)  
**response:** `200`
```json
{ "message": "Variant deleted" }
```

---

## 9. Stock Movements

### List Stock Movements
```
Method:   GET
URL:      /api/stock-movements
Auth:     Required
```
**req_param (query):**

| Param       | Type     | Description                                                               |
|-------------|----------|---------------------------------------------------------------------------|
| `page`      | `number` |                                                                           |
| `pageSize`  | `number` |                                                                           |
| `productId` | `number` | Filter by product                                                         |
| `type`      | `string` | Filter: `PURCHASE \| SALE \| SALE_RETURN \| PURCHASE_RETURN \| ADJUSTMENT \| OPENING` |
| `from`      | `ISO date`| Filter from date                                                         |
| `to`        | `ISO date`| Filter to date                                                           |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "productId": "number",
      "product": { "id": "number", "name": "string" },
      "type": "string",
      "quantity": "number (positive = in, negative = out)",
      "note": "string | null",
      "reference": "string | null",
      "referenceId": "number | null",
      "accountId": "number | null",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Create Stock Adjustment
```
Method:   POST
URL:      /api/stock-movements/adjustment
Auth:     Required
```
**req_body:**
```json
{
  "productId": "number (required)",
  "quantity":  "number (required — positive to add, negative to remove)",
  "note":      "string (optional)",
  "accountId": "number (optional)"
}
```
**response:** `201` — Created stock movement  
> Side effects: Updates product `totalStock`. Returns 400 if resulting stock < 0 and `allowNegative` is false.

---

## 10. Sales

### List Sales
```
Method:   GET
URL:      /api/sales
Auth:     Required
```
**req_param (query):**

| Param        | Type      | Description             |
|--------------|-----------|-------------------------|
| `page`       | `number`  |                         |
| `pageSize`   | `number`  |                         |
| `customerId` | `number`  | Filter by customer      |
| `userId`     | `number`  | Filter by cashier/user  |
| `from`       | `ISO date`| Filter from date        |
| `to`         | `ISO date`| Filter to date          |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "customerId": "number | null",
      "customer": { "id": "number", "name": "string" },
      "userId": "number | null",
      "user": { "id": "number", "name": "string" },
      "totalAmount": "number",
      "paidAmount": "number",
      "changeAmount": "number",
      "discount": "number",
      "taxAmount": "number",
      "taxInvoiceId": "string | null",
      "createdAt": "ISO date",
      "payments": [ ...SalePayment with account ]
    }
  ],
  "pagination": { ... }
}
```

---

### Get Sale
```
Method:   GET
URL:      /api/sales/:id
Auth:     Required
```
**req_param:** `id` — Sale ID (number)  
**response:** `200`
```json
{
  "id": "number",
  "customerId": "number | null",
  "customer": { ... },
  "userId": "number | null",
  "user": { "id": "number", "name": "string", "username": "string" },
  "totalAmount": "number",
  "paidAmount": "number",
  "changeAmount": "number",
  "discount": "number",
  "taxAmount": "number",
  "taxInvoiceId": "string | null",
  "createdAt": "ISO date",
  "items": [
    {
      "id": "number",
      "variantId": "number",
      "variant": { ...ProductVariant with product },
      "quantity": "number",
      "unitPrice": "number",
      "discount": "number",
      "totalPrice": "number",
      "avgCostPrice": "number"
    }
  ],
  "payments": [ ...SalePayment with account ],
  "returns": [ ...SaleReturn with items ]
}
```

---

### Create Sale
```
Method:   POST
URL:      /api/sales
Auth:     Required
```
**req_body:**
```json
{
  "items": [
    {
      "variantId": "number (required)",
      "quantity":  "number (required)",
      "unitPrice": "number (required)",
      "discount":  "number (optional, default 0)"
    }
  ],
  "payments": [
    {
      "accountId":    "number (required)",
      "amount":       "number (required)",
      "changeAmount": "number (optional, default 0)",
      "note":         "string (optional)"
    }
  ],
  "customerId":   "number (optional)",
  "discount":     "number (optional, default 0 — overall sale discount)",
  "taxAmount":    "number (optional, default 0)",
  "taxInvoiceId": "string (optional)"
}
```
**response:** `201` — Full sale object with items and payments  
> Side effects: Decrements product stock, creates StockMovement records, updates customer balance/ledger if `customerId` provided and amount is unpaid.

---

### Delete Sale
```
Method:   DELETE
URL:      /api/sales/:id
Auth:     Required
```
**req_param:** `id` — Sale ID (number)  
**response:** `200`
```json
{ "message": "Sale deleted" }
```
> Warning: Does NOT reverse stock or customer balance. Use Sale Returns for proper reversal.

---

### List Sale Returns
```
Method:   GET
URL:      /api/sales/returns/all
Auth:     Required
```
**req_param (query):**

| Param    | Type     | Description                                  |
|----------|----------|----------------------------------------------|
| `page`   | `number` |                                              |
| `pageSize`| `number`|                                              |
| `saleId` | `number` | Filter by original sale                      |
| `status` | `string` | Filter: `PENDING \| APPROVED \| REJECTED \| PROCESSED` |
| `userId` | `number` | Filter by requesting user                    |

**response:** `200` — Paginated list of sale returns

---

### Get Sale Return
```
Method:   GET
URL:      /api/sales/returns/:id
Auth:     Required
```
**req_param:** `id` — Sale Return ID (number)  
**response:** `200`
```json
{
  "id": "number",
  "saleId": "number",
  "sale": { ...Sale with customer and items },
  "userId": "number | null",
  "user": { "id": "number", "name": "string" },
  "adminId": "number | null",
  "admin": { "id": "number", "name": "string" },
  "reason": "string | null",
  "status": "PENDING | APPROVED | REJECTED | PROCESSED",
  "totalRefund": "number",
  "originalSaleTotal": "number",
  "requiresApproval": "boolean",
  "adminNotes": "string | null",
  "requestedAt": "ISO date",
  "approvedAt": "ISO date | null",
  "rejectedAt": "ISO date | null",
  "processedAt": "ISO date | null",
  "accountId": "number | null",
  "account": { ... },
  "items": [
    {
      "id": "number",
      "variantId": "number",
      "variant": { ...ProductVariant with product },
      "quantity": "number",
      "unitPrice": "number",
      "discount": "number"
    }
  ]
}
```

---

### Create Sale Return
```
Method:   POST
URL:      /api/sales/returns
Auth:     Required
```
**req_body:**
```json
{
  "saleId":           "number (required)",
  "items": [
    {
      "variantId": "number (required)",
      "quantity":  "number (required)",
      "unitPrice": "number (required)",
      "discount":  "number (optional, default 0)"
    }
  ],
  "reason":           "string (optional)",
  "requiresApproval": "boolean (optional, default true)"
}
```
**response:** `201` — Sale return with status `PENDING` (or `APPROVED` if `requiresApproval` is false)

---

### Approve Sale Return
```
Method:   PATCH
URL:      /api/sales/returns/:id/approve
Auth:     Required
```
**req_param:** `id` — Sale Return ID (number)  
**req_body:**
```json
{
  "adminNotes": "string (optional)"
}
```
**response:** `200` — Updated sale return with status `APPROVED`  
> Only works on `PENDING` returns.

---

### Reject Sale Return
```
Method:   PATCH
URL:      /api/sales/returns/:id/reject
Auth:     Required
```
**req_param:** `id` — Sale Return ID (number)  
**req_body:**
```json
{
  "adminNotes": "string (optional)"
}
```
**response:** `200` — Updated sale return with status `REJECTED`  
> Only works on `PENDING` returns.

---

### Process Sale Return
```
Method:   PATCH
URL:      /api/sales/returns/:id/process
Auth:     Required
```
**req_param:** `id` — Sale Return ID (number)  
**req_body:**
```json
{
  "accountId": "number (optional — account to issue refund from)"
}
```
**response:** `200` — Updated sale return with status `PROCESSED`  
> Only works on `APPROVED` returns. Side effects: Restores stock, creates StockMovement records, updates customer balance/ledger.

---

## 11. Purchases

### List Purchases
```
Method:   GET
URL:      /api/purchases
Auth:     Required
```
**req_param (query):**

| Param        | Type      | Description          |
|--------------|-----------|----------------------|
| `page`       | `number`  |                      |
| `pageSize`   | `number`  |                      |
| `supplierId` | `number`  | Filter by supplier   |
| `userId`     | `number`  | Filter by user       |
| `from`       | `ISO date`| Filter from date     |
| `to`         | `ISO date`| Filter to date       |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "invoiceNo": "string | null",
      "supplierId": "number | null",
      "supplier": { "id": "number", "name": "string" },
      "userId": "number | null",
      "user": { "id": "number", "name": "string" },
      "accountId": "number",
      "account": { ... },
      "totalAmount": "number",
      "paidAmount": "number",
      "discount": "number",
      "taxAmount": "number",
      "expenses": "number",
      "date": "ISO date",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Get Purchase
```
Method:   GET
URL:      /api/purchases/:id
Auth:     Required
```
**req_param:** `id` — Purchase ID (number)  
**response:** `200` — Full purchase with supplier, account, items (with variants and products), and returns

---

### Create Purchase
```
Method:   POST
URL:      /api/purchases
Auth:     Required
```
**req_body:**
```json
{
  "accountId":  "number (required — account paid from)",
  "items": [
    {
      "variantId": "number (required)",
      "quantity":  "number (required)",
      "unitCost":  "number (required)",
      "discount":  "number (optional, default 0)",
      "taxAmount": "number (optional, default 0)"
    }
  ],
  "invoiceNo":  "string (optional)",
  "supplierId": "number (optional)",
  "discount":   "number (optional, default 0 — overall purchase discount)",
  "taxAmount":  "number (optional, default 0 — overall purchase tax)",
  "expenses":   "number (optional, default 0 — additional costs)",
  "paidAmount": "number (optional, default 0)",
  "date":       "ISO date string (optional, defaults to now)"
}
```
**response:** `201` — Full purchase with items, account, and supplier  
> Side effects: Increments product stock, updates `avgCostPrice` (weighted average), creates StockMovement records, updates supplier balance/ledger if `supplierId` provided and amount is unpaid.

---

### Delete Purchase
```
Method:   DELETE
URL:      /api/purchases/:id
Auth:     Required
```
**req_param:** `id` — Purchase ID (number)  
**response:** `200`
```json
{ "message": "Purchase deleted" }
```

---

### List Purchase Returns
```
Method:   GET
URL:      /api/purchases/returns/all
Auth:     Required
```
**req_param (query):**

| Param        | Type     | Description          |
|--------------|----------|----------------------|
| `page`       | `number` |                      |
| `pageSize`   | `number` |                      |
| `purchaseId` | `number` | Filter by purchase   |

**response:** `200` — Paginated list of purchase returns with items and account

---

### Get Purchase Return
```
Method:   GET
URL:      /api/purchases/returns/:id
Auth:     Required
```
**req_param:** `id` — Purchase Return ID (number)  
**response:** `200` — Full purchase return with purchase (including supplier), items, and account

---

### Create Purchase Return
```
Method:   POST
URL:      /api/purchases/returns
Auth:     Required
```
**req_body:**
```json
{
  "purchaseId": "number (required)",
  "items": [
    {
      "variantId": "number (required)",
      "quantity":  "number (required)",
      "unitCost":  "number (required)",
      "discount":  "number (optional, default 0)"
    }
  ],
  "reason":    "string (optional)",
  "accountId": "number (optional — account to receive refund)",
  "date":      "ISO date string (optional, defaults to now)"
}
```
**response:** `201` — Purchase return with items  
> Side effects: Decrements product stock, creates StockMovement records, decreases supplier balance/ledger.

---

## 12. Packages

Bundles of product variants sold together.

### List Packages
```
Method:   GET
URL:      /api/packages
Auth:     Required
```
**req_param (query):**

| Param    | Type      | Description               |
|----------|-----------|---------------------------|
| `page`   | `number`  |                           |
| `pageSize`| `number` |                           |
| `q`      | `string`  | Search by name or code    |
| `active` | `boolean` | Filter: `true` or `false` |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "name": "string",
      "code": "string",
      "description": "string | null",
      "price": "number",
      "discount": "number",
      "active": "boolean",
      "createdAt": "ISO date",
      "packageItems": [
        {
          "id": "number",
          "variantId": "number",
          "quantity": "number",
          "variant": { ...ProductVariant with product }
        }
      ]
    }
  ],
  "pagination": { ... }
}
```

---

### Get Package
```
Method:   GET
URL:      /api/packages/:id
Auth:     Required
```
**req_param:** `id` — Package ID (number)  
**response:** `200` — Package with packageItems (variants with products)

---

### Create Package
```
Method:   POST
URL:      /api/packages
Auth:     Required
```
**req_body:**
```json
{
  "name":        "string (required)",
  "code":        "string (required, unique)",
  "price":       "number (required)",
  "description": "string (optional)",
  "discount":    "number (optional, default 0)",
  "active":      "boolean (optional, default true)",
  "items": [
    {
      "variantId": "number (required)",
      "quantity":  "number (required)"
    }
  ]
}
```
**response:** `201` — Created package with packageItems

---

### Update Package
```
Method:   PUT
URL:      /api/packages/:id
Auth:     Required
```
**req_param:** `id` — Package ID (number)  
**req_body:** (all optional — does NOT update items; manage items separately)
```json
{
  "name":        "string",
  "code":        "string",
  "description": "string",
  "price":       "number",
  "discount":    "number",
  "active":      "boolean"
}
```
**response:** `200` — Updated package object

---

### Delete Package
```
Method:   DELETE
URL:      /api/packages/:id
Auth:     Required
```
**req_param:** `id` — Package ID (number)  
**response:** `200`
```json
{ "message": "Package deleted" }
```

---

### Add Package Item
```
Method:   POST
URL:      /api/packages/:id/items
Auth:     Required
```
**req_param:** `id` — Package ID (number)  
**req_body:**
```json
{
  "variantId": "number (required)",
  "quantity":  "number (required)"
}
```
**response:** `201` — Created package item with variant details

---

### Remove Package Item
```
Method:   DELETE
URL:      /api/packages/:id/items/:itemId
Auth:     Required
```
**req_param:** `id` — Package ID, `itemId` — PackageItem ID (number)  
**response:** `200`
```json
{ "message": "Package item removed" }
```

---

## 13. Employees

### List Employees
```
Method:   GET
URL:      /api/employees
Auth:     Required
```
**req_param (query):**

| Param    | Type      | Description                       |
|----------|-----------|-----------------------------------|
| `page`   | `number`  |                                   |
| `pageSize`| `number` |                                   |
| `q`      | `string`  | Search by linked user name/username|
| `active` | `boolean` | Filter: `true` or `false`         |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "userId": "number",
      "user": { "id": "number", "name": "string", "username": "string", "role": "string", "phone": "string | null" },
      "designation": "string | null",
      "baseSalary": "number",
      "advanceLimit": "number",
      "balance": "number",
      "joiningDate": "ISO date",
      "active": "boolean",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Get Employee
```
Method:   GET
URL:      /api/employees/:id
Auth:     Required
```
**req_param:** `id` — Employee ID (number)  
**response:** `200` — Employee with user, last 20 ledger entries, last 12 salary slips, last 10 advances

---

### Create Employee
```
Method:   POST
URL:      /api/employees
Auth:     Required
```
**req_body:**
```json
{
  "userId":       "number (required — must be an existing user)",
  "joiningDate":  "ISO date string (required)",
  "baseSalary":   "number (required)",
  "designation":  "string (optional)",
  "advanceLimit": "number (optional, default 0 — 0 means no limit check)",
  "active":       "boolean (optional, default true)"
}
```
**response:** `201` — Created employee with user details

---

### Update Employee
```
Method:   PUT
URL:      /api/employees/:id
Auth:     Required
```
**req_param:** `id` — Employee ID (number)  
**req_body:** (all optional)
```json
{
  "joiningDate":  "ISO date string",
  "designation":  "string",
  "baseSalary":   "number",
  "advanceLimit": "number",
  "active":       "boolean"
}
```
**response:** `200` — Updated employee object

---

### Delete Employee
```
Method:   DELETE
URL:      /api/employees/:id
Auth:     Required
```
**req_param:** `id` — Employee ID (number)  
**response:** `200`
```json
{ "message": "Employee deleted" }
```

---

### List Employee Ledger
```
Method:   GET
URL:      /api/employees/:id/ledger
Auth:     Required
```
**req_param:** `id` — Employee ID (number)  
**req_param (query):** `page`, `pageSize`  
**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "employeeId": "number",
      "type": "SALARY | SALARY_PAID | ADVANCE | DEDUCTION | ADJUSTMENT",
      "amount": "number",
      "balance": "number",
      "note": "string | null",
      "reference": "string | null",
      "referenceId": "number | null",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### List Employee Advances
```
Method:   GET
URL:      /api/employees/:id/advances
Auth:     Required
```
**req_param:** `id` — Employee ID (number)  
**req_param (query):**

| Param    | Type     | Description                                      |
|----------|----------|--------------------------------------------------|
| `page`   | `number` |                                                  |
| `pageSize`| `number`|                                                  |
| `status` | `string` | Filter: `PENDING \| DEDUCTED \| CANCELLED`       |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "employeeId": "number",
      "amount": "number",
      "accountId": "number",
      "account": { ... },
      "reason": "string | null",
      "month": "number",
      "year": "number",
      "status": "PENDING | DEDUCTED | CANCELLED",
      "deductedIn": "number | null (salary slip ID)",
      "date": "ISO date",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Create Employee Advance
```
Method:   POST
URL:      /api/employees/:id/advances
Auth:     Required
```
**req_param:** `id` — Employee ID (number)  
**req_body:**
```json
{
  "amount":    "number (required)",
  "accountId": "number (required — account paying from)",
  "month":     "number (required — e.g. 3 for March)",
  "year":      "number (required — e.g. 2026)",
  "reason":    "string (optional)"
}
```
**response:** `201` — Created advance with account details  
> Side effects: Creates employee ledger entry, decreases employee balance. Returns 400 if advance limit would be exceeded.

---

## 14. Salary Slips

### List Salary Slips
```
Method:   GET
URL:      /api/salary-slips
Auth:     Required
```
**req_param (query):**

| Param        | Type     | Description                                    |
|--------------|----------|------------------------------------------------|
| `page`       | `number` |                                                |
| `pageSize`   | `number` |                                                |
| `employeeId` | `number` | Filter by employee                             |
| `status`     | `string` | Filter: `DRAFT \| APPROVED \| PAID \| CANCELLED` |
| `year`       | `number` | Filter by year                                 |
| `month`      | `number` | Filter by month (1-12)                         |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "employeeId": "number",
      "employee": { ...Employee with user },
      "year": "number",
      "month": "number",
      "baseSalary": "number",
      "bonus": "number",
      "totalAdvances": "number",
      "otherDeductions": "number",
      "netPayable": "number",
      "status": "DRAFT | APPROVED | PAID | CANCELLED",
      "accountId": "number | null",
      "account": { ... },
      "note": "string | null",
      "paidDate": "ISO date | null",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Get Salary Slip
```
Method:   GET
URL:      /api/salary-slips/:id
Auth:     Required
```
**req_param:** `id` — Salary Slip ID (number)  
**response:** `200` — Salary slip with employee, account, and linked advances

---

### Generate Salary Slip
```
Method:   POST
URL:      /api/salary-slips
Auth:     Required
```
**req_body:**
```json
{
  "employeeId":     "number (required)",
  "year":           "number (required)",
  "month":          "number (required — 1-12)",
  "bonus":          "number (optional, default 0)",
  "otherDeductions":"number (optional, default 0)",
  "accountId":      "number (optional)",
  "note":           "string (optional)"
}
```
**response:** `201` — Generated salary slip with status `DRAFT`  
> Side effects: Fetches all PENDING advances for that month/year and marks them as DEDUCTED, creates employee ledger SALARY entry, updates employee balance. Returns 409 if slip already exists for that month.

---

### Approve Salary Slip
```
Method:   PATCH
URL:      /api/salary-slips/:id/approve
Auth:     Required
```
**req_param:** `id` — Salary Slip ID (number)  
**req_body:** None  
**response:** `200` — Updated slip with status `APPROVED`  
> Only works on `DRAFT` slips.

---

### Pay Salary Slip
```
Method:   PATCH
URL:      /api/salary-slips/:id/pay
Auth:     Required
```
**req_param:** `id` — Salary Slip ID (number)  
**req_body:**
```json
{
  "accountId": "number (optional — account to pay salary from)"
}
```
**response:** `200` — Updated slip with status `PAID`  
> Only works on `APPROVED` slips. Side effects: Creates SALARY_PAID ledger entry, decreases employee balance.

---

### Cancel Salary Slip
```
Method:   PATCH
URL:      /api/salary-slips/:id/cancel
Auth:     Required
```
**req_param:** `id` — Salary Slip ID (number)  
**req_body:** None  
**response:** `200` — Updated slip with status `CANCELLED`  
> Cannot cancel a `PAID` slip.

---

## 15. Expenses

### List Expenses
```
Method:   GET
URL:      /api/expenses
Auth:     Required
```
**req_param (query):**

| Param      | Type      | Description                |
|------------|-----------|----------------------------|
| `page`     | `number`  |                            |
| `pageSize` | `number`  |                            |
| `q`        | `string`  | Search by description or category |
| `category` | `string`  | Filter by category name    |
| `userId`   | `number`  | Filter by who created      |
| `from`     | `ISO date`| Filter from date           |
| `to`       | `ISO date`| Filter to date             |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "description": "string",
      "amount": "number",
      "category": "string",
      "accountId": "number",
      "account": { ... },
      "userId": "number | null",
      "user": { "id": "number", "name": "string" },
      "date": "ISO date",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Get Expense
```
Method:   GET
URL:      /api/expenses/:id
Auth:     Required
```
**req_param:** `id` — Expense ID (number)  
**response:** `200` — Single expense with account and user

---

### Create Expense
```
Method:   POST
URL:      /api/expenses
Auth:     Required
```
**req_body:**
```json
{
  "description": "string (required)",
  "amount":      "number (required)",
  "category":    "string (required)",
  "accountId":   "number (required — account paid from)",
  "date":        "ISO date string (optional, defaults to now)"
}
```
**response:** `201` — Created expense with account

---

### Update Expense
```
Method:   PUT
URL:      /api/expenses/:id
Auth:     Required
```
**req_param:** `id` — Expense ID (number)  
**req_body:** (all optional)
```json
{
  "description": "string",
  "amount":      "number",
  "category":    "string",
  "accountId":   "number",
  "date":        "ISO date string"
}
```
**response:** `200` — Updated expense with account

---

### Delete Expense
```
Method:   DELETE
URL:      /api/expenses/:id
Auth:     Required
```
**req_param:** `id` — Expense ID (number)  
**response:** `200`
```json
{ "message": "Expense deleted" }
```

---

## 16. Recurring Expenses

### List Recurring Expenses
```
Method:   GET
URL:      /api/recurring-expenses
Auth:     Required
```
**req_param (query):**

| Param       | Type      | Description                                            |
|-------------|-----------|--------------------------------------------------------|
| `page`      | `number`  |                                                        |
| `pageSize`  | `number`  |                                                        |
| `q`         | `string`  | Search by name                                         |
| `active`    | `boolean` | Filter: `true` or `false`                              |
| `frequency` | `string`  | Filter: `DAILY \| WEEKLY \| MONTHLY \| QUARTERLY \| YEARLY` |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "name": "string",
      "description": "string | null",
      "category": "string",
      "amount": "number",
      "frequency": "DAILY | WEEKLY | MONTHLY | QUARTERLY | YEARLY",
      "startDate": "ISO date",
      "endDate": "ISO date | null",
      "active": "boolean",
      "accountId": "number | null",
      "account": { ... },
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Get Recurring Expense
```
Method:   GET
URL:      /api/recurring-expenses/:id
Auth:     Required
```
**req_param:** `id` — Recurring Expense ID (number)  
**response:** `200` — Single recurring expense with account

---

### Create Recurring Expense
```
Method:   POST
URL:      /api/recurring-expenses
Auth:     Required
```
**req_body:**
```json
{
  "name":        "string (required)",
  "category":    "string (required)",
  "amount":      "number (required)",
  "startDate":   "ISO date string (required)",
  "description": "string (optional)",
  "frequency":   "DAILY | WEEKLY | MONTHLY | QUARTERLY | YEARLY (optional, default MONTHLY)",
  "endDate":     "ISO date string (optional)",
  "active":      "boolean (optional, default true)",
  "accountId":   "number (optional)"
}
```
**response:** `201` — Created recurring expense object

---

### Update Recurring Expense
```
Method:   PUT
URL:      /api/recurring-expenses/:id
Auth:     Required
```
**req_param:** `id` — Recurring Expense ID (number)  
**req_body:** (all optional)
```json
{
  "name":        "string",
  "description": "string",
  "category":    "string",
  "amount":      "number",
  "frequency":   "DAILY | WEEKLY | MONTHLY | QUARTERLY | YEARLY",
  "startDate":   "ISO date string",
  "endDate":     "ISO date string",
  "active":      "boolean",
  "accountId":   "number"
}
```
**response:** `200` — Updated recurring expense object

---

### Delete Recurring Expense
```
Method:   DELETE
URL:      /api/recurring-expenses/:id
Auth:     Required
```
**req_param:** `id` — Recurring Expense ID (number)  
**response:** `200`
```json
{ "message": "Recurring expense deleted" }
```

---

## 17. Advance Bookings

Pre-orders with advance payment.

### List Advance Bookings
```
Method:   GET
URL:      /api/advance-bookings
Auth:     Required
```
**req_param (query):**

| Param        | Type      | Description                                          |
|--------------|-----------|------------------------------------------------------|
| `page`       | `number`  |                                                      |
| `pageSize`   | `number`  |                                                      |
| `customerId` | `number`  | Filter by customer                                   |
| `status`     | `string`  | Filter: `PENDING \| CONFIRMED \| CANCELLED \| FULFILLED` |
| `from`       | `ISO date`| Filter delivery date from                            |
| `to`         | `ISO date`| Filter delivery date to                              |

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "customerId": "number | null",
      "customer": { "id": "number", "name": "string", "phone": "string | null" },
      "totalAmount": "number",
      "advancePayment": "number",
      "instructions": "string | null",
      "deliveryDate": "ISO date",
      "status": "PENDING | CONFIRMED | CANCELLED | FULFILLED",
      "createdAt": "ISO date",
      "advanceBookingItems": [
        {
          "id": "number",
          "variantId": "number",
          "quantity": "number",
          "unitPrice": "number",
          "variant": { ...ProductVariant with product }
        }
      ]
    }
  ],
  "pagination": { ... }
}
```

---

### Get Advance Booking
```
Method:   GET
URL:      /api/advance-bookings/:id
Auth:     Required
```
**req_param:** `id` — Booking ID (number)  
**response:** `200` — Full booking with customer and items

---

### Create Advance Booking
```
Method:   POST
URL:      /api/advance-bookings
Auth:     Required
```
**req_body:**
```json
{
  "deliveryDate":   "ISO date string (required)",
  "totalAmount":    "number (required)",
  "items": [
    {
      "variantId": "number (required)",
      "quantity":  "number (required)",
      "unitPrice": "number (required)"
    }
  ],
  "customerId":     "number (optional)",
  "advancePayment": "number (optional, default 0)",
  "instructions":   "string (optional)"
}
```
**response:** `201` — Created booking with customer and items

---

### Update Advance Booking Status
```
Method:   PATCH
URL:      /api/advance-bookings/:id/status
Auth:     Required
```
**req_param:** `id` — Booking ID (number)  
**req_body:**
```json
{
  "status": "PENDING | CONFIRMED | CANCELLED | FULFILLED (required)"
}
```
**response:** `200` — Updated booking object

---

### Delete Advance Booking
```
Method:   DELETE
URL:      /api/advance-bookings/:id
Auth:     Required
```
**req_param:** `id` — Booking ID (number)  
**response:** `200`
```json
{ "message": "Advance booking deleted" }
```

---

## 18. Promotions

### Get Active Promotions
```
Method:   GET
URL:      /api/promotions/active
Auth:     Required
```
**req_param:** None  
**response:** `200` — Array of currently active promotions (active=true, within startDate–endDate)
```json
[
  {
    "id": "number",
    "name": "string",
    "discountType": "PERCENTAGE | FIXED_AMOUNT",
    "discountValue": "number",
    "conditionType": "ALL_CUSTOMERS | MINIMUM_PURCHASE | REPEAT_CUSTOMERS | PRODUCT_SPECIFIC",
    "minPurchaseAmount": "number | null",
    "startDate": "ISO date",
    "endDate": "ISO date",
    "active": "boolean",
    "promotionItems": [ ...items with variant ]
  }
]
```

---

### List Promotions
```
Method:   GET
URL:      /api/promotions
Auth:     Required
```
**req_param (query):**

| Param    | Type      | Description               |
|----------|-----------|---------------------------|
| `page`   | `number`  |                           |
| `pageSize`| `number` |                           |
| `q`      | `string`  | Search by name            |
| `active` | `boolean` | Filter: `true` or `false` |

**response:** `200` — Paginated list of promotions

---

### Get Promotion
```
Method:   GET
URL:      /api/promotions/:id
Auth:     Required
```
**req_param:** `id` — Promotion ID (number)  
**response:** `200` — Promotion with promotionItems (variants with products)

---

### Create Promotion
```
Method:   POST
URL:      /api/promotions
Auth:     Required
```
**req_body:**
```json
{
  "name":               "string (required)",
  "startDate":          "ISO date string (required)",
  "endDate":            "ISO date string (required)",
  "discountType":       "PERCENTAGE | FIXED_AMOUNT (required)",
  "discountValue":      "number (required)",
  "conditionType":      "ALL_CUSTOMERS | MINIMUM_PURCHASE | REPEAT_CUSTOMERS | PRODUCT_SPECIFIC (required)",
  "description":        "string (optional)",
  "minPurchaseAmount":  "number (optional — required if conditionType is MINIMUM_PURCHASE)",
  "active":             "boolean (optional, default true)",
  "variantIds":         "number[] (optional — required if conditionType is PRODUCT_SPECIFIC)"
}
```
**response:** `201` — Created promotion with promotionItems

---

### Update Promotion
```
Method:   PUT
URL:      /api/promotions/:id
Auth:     Required
```
**req_param:** `id` — Promotion ID (number)  
**req_body:** (all optional)
```json
{
  "name":              "string",
  "description":       "string",
  "startDate":         "ISO date string",
  "endDate":           "ISO date string",
  "discountType":      "PERCENTAGE | FIXED_AMOUNT",
  "discountValue":     "number",
  "conditionType":     "ALL_CUSTOMERS | MINIMUM_PURCHASE | REPEAT_CUSTOMERS | PRODUCT_SPECIFIC",
  "minPurchaseAmount": "number",
  "active":            "boolean"
}
```
**response:** `200` — Updated promotion object

---

### Delete Promotion
```
Method:   DELETE
URL:      /api/promotions/:id
Auth:     Required
```
**req_param:** `id` — Promotion ID (number)  
**response:** `200`
```json
{ "message": "Promotion deleted" }
```

---

## 19. Held Transactions

Temporarily held sales or purchases that can be resumed later.

### List Held Sales
```
Method:   GET
URL:      /api/held/sales
Auth:     Required
```
**req_param (query):**

| Param    | Type     | Description                              |
|----------|----------|------------------------------------------|
| `page`   | `number` |                                          |
| `pageSize`| `number`|                                          |
| `status` | `string` | Filter: `HELD \| RESUMED \| CANCELLED`   |

> Only returns held sales belonging to the authenticated user.

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "userId": "number",
      "saleData": "object (any — the full cart snapshot stored as JSON)",
      "note": "string | null",
      "status": "HELD | RESUMED | CANCELLED",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Get Held Sale
```
Method:   GET
URL:      /api/held/sales/:id
Auth:     Required
```
**req_param:** `id` — Held Sale ID (number)  
**response:** `200` — Single held sale object

---

### Create Held Sale
```
Method:   POST
URL:      /api/held/sales
Auth:     Required
```
**req_body:**
```json
{
  "saleData": "object (required — full cart state to be stored as JSON)",
  "note":     "string (optional)"
}
```
**response:** `201` — Created held sale with status `HELD`

---

### Resume Held Sale
```
Method:   PATCH
URL:      /api/held/sales/:id/resume
Auth:     Required
```
**req_param:** `id` — Held Sale ID (number)  
**req_body:** None  
**response:** `200` — Updated held sale with status `RESUMED`

---

### Cancel Held Sale
```
Method:   PATCH
URL:      /api/held/sales/:id/cancel
Auth:     Required
```
**req_param:** `id` — Held Sale ID (number)  
**req_body:** None  
**response:** `200` — Updated held sale with status `CANCELLED`

---

### List Held Purchases
```
Method:   GET
URL:      /api/held/purchases
Auth:     Required
```
**req_param (query):** Same as List Held Sales  
> Only returns held purchases belonging to the authenticated user.

**response:** `200` — Paginated list
```json
{
  "data": [
    {
      "id": "number",
      "userId": "number",
      "purchaseData": "object (any — the full cart snapshot stored as JSON)",
      "note": "string | null",
      "status": "HELD | RESUMED | CANCELLED",
      "createdAt": "ISO date"
    }
  ],
  "pagination": { ... }
}
```

---

### Get Held Purchase
```
Method:   GET
URL:      /api/held/purchases/:id
Auth:     Required
```
**req_param:** `id` — Held Purchase ID (number)  
**response:** `200` — Single held purchase object

---

### Create Held Purchase
```
Method:   POST
URL:      /api/held/purchases
Auth:     Required
```
**req_body:**
```json
{
  "purchaseData": "object (required — full cart state to be stored as JSON)",
  "note":         "string (optional)"
}
```
**response:** `201` — Created held purchase with status `HELD`

---

### Resume Held Purchase
```
Method:   PATCH
URL:      /api/held/purchases/:id/resume
Auth:     Required
```
**req_param:** `id` — Held Purchase ID (number)  
**req_body:** None  
**response:** `200` — Updated held purchase with status `RESUMED`

---

### Cancel Held Purchase
```
Method:   PATCH
URL:      /api/held/purchases/:id/cancel
Auth:     Required
```
**req_param:** `id` — Held Purchase ID (number)  
**req_body:** None  
**response:** `200` — Updated held purchase with status `CANCELLED`

---

## 20. Reports

JSON report endpoints are `GET` requests and return JSON (not paginated). Each has a corresponding `/pdf` variant that streams a PDF file download. Statement reports (`/customer-statement/:id`, `/supplier-statement/:id`) are PDF-only.

### Dashboard Stats
```
Method:   GET
URL:      /api/reports/dashboard
Auth:     Required
```
**req_param:** None  
**response:** `200`
```json
{
  "today": {
    "salesTotal": "number",
    "salesCount": "number"
  },
  "thisMonth": {
    "salesTotal": "number",
    "salesCount": "number",
    "purchasesTotal": "number",
    "purchasesCount": "number",
    "expensesTotal": "number",
    "expensesCount": "number"
  },
  "inventory": {
    "lowStockCount": "number"
  },
  "pendingReturns": "number",
  "totalCustomers": "number",
  "totalSuppliers": "number"
}
```

---

### Sales Report
```
Method:   GET
URL:      /api/reports/sales
Auth:     Required
```
**req_param (query):**

| Param    | Type      | Description     |
|----------|-----------|-----------------|
| `from`   | `ISO date`| Filter from date|
| `to`     | `ISO date`| Filter to date  |

**response:** `200`
```json
{
  "totalRevenue": "number",
  "totalDiscount": "number",
  "totalTax": "number",
  "totalCOGS": "number",
  "grossProfit": "number",
  "salesCount": "number",
  "sales": [ ...full sale objects with items, customer, and payments ]
}
```

---

### Purchases Report
```
Method:   GET
URL:      /api/reports/purchases
Auth:     Required
```
**req_param (query):**

| Param  | Type      | Description     |
|--------|-----------|-----------------|
| `from` | `ISO date`| Filter from date|
| `to`   | `ISO date`| Filter to date  |

**response:** `200`
```json
{
  "totalCost": "number",
  "totalPaid": "number",
  "totalDue": "number",
  "purchasesCount": "number",
  "purchases": [ ...full purchase objects with supplier and items ]
}
```

---

### Inventory Report
```
Method:   GET
URL:      /api/reports/inventory
Auth:     Required
```
**req_param:** None  
**response:** `200`
```json
{
  "totalProducts": "number",
  "lowStockCount": "number",
  "outOfStockCount": "number",
  "totalInventoryValue": "number",
  "products": [ ...all active products with category, brand, variants ],
  "lowStock": [ ...products where totalStock <= reorderLevel ],
  "outOfStock": [ ...products where totalStock === 0 ]
}
```

---

### Expenses Report
```
Method:   GET
URL:      /api/reports/expenses
Auth:     Required
```
**req_param (query):**

| Param  | Type      | Description     |
|--------|-----------|-----------------|
| `from` | `ISO date`| Filter from date|
| `to`   | `ISO date`| Filter to date  |

**response:** `200`
```json
{
  "totalAmount": "number",
  "expensesCount": "number",
  "byCategory": {
    "categoryName": "number (total amount)",
    "...": "..."
  },
  "expenses": [ ...full expense objects ]
}
```

---

### Customer Balances Report
```
Method:   GET
URL:      /api/reports/customer-balances
Auth:     Required
```
**req_param:** None  
**response:** `200`
```json
{
  "totalReceivable": "number (sum of all positive balances)",
  "count": "number",
  "customers": [ ...active customers with non-zero balance, sorted by balance descending ]
}
```

---

### Supplier Balances Report
```
Method:   GET
URL:      /api/reports/supplier-balances
Auth:     Required
```
**req_param:** None  
**response:** `200`
```json
{
  "totalPayable": "number (sum of all positive balances)",
  "count": "number",
  "suppliers": [ ...active suppliers with non-zero balance, sorted by balance descending ]
}
```

---

## PDF Reports

All PDF endpoints respond with `Content-Type: application/pdf` and a file download.  
They accept the same date-range query params (`from`, `to`) as their JSON counterparts unless stated otherwise.

---

### Sales Report PDF
```
Method:   GET
URL:      /api/reports/sales/pdf
Auth:     Required
```
**req_param (query):**

| Param  | Type      | Description      |
|--------|-----------|------------------|
| `from` | `ISO date`| Filter from date |
| `to`   | `ISO date`| Filter to date   |

**response:** `200` — PDF download (`sales-report-YYYY-MM-DD.pdf`)  
Landscape A4. Contains:
- Summary table: Total Revenue, Discount, Tax, Cost of Goods, Gross Profit
- Transactions table: #, Date, Customer, Items, Discount, Tax, Total, Paid, Due
- Grand total row

---

### Purchases Report PDF
```
Method:   GET
URL:      /api/reports/purchases/pdf
Auth:     Required
```
**req_param (query):**

| Param  | Type      | Description      |
|--------|-----------|------------------|
| `from` | `ISO date`| Filter from date |
| `to`   | `ISO date`| Filter to date   |

**response:** `200` — PDF download (`purchases-report-YYYY-MM-DD.pdf`)  
Landscape A4. Contains:
- Summary table: Total Cost, Discount, Tax, Total Due
- Orders table: #, Date, Supplier, Invoice No., Items, Discount, Tax, Total, Paid, Due
- Grand total row

---

### Inventory Report PDF
```
Method:   GET
URL:      /api/reports/inventory/pdf
Auth:     Required
```
**req_param:** None  
**response:** `200` — PDF download (`inventory-report-YYYY-MM-DD.pdf`)  
Landscape A4. Contains:
- Summary table: Total Products, Low Stock, Out of Stock, Total Inventory Value
- Products table: #, Product, Category, Brand, Total Stock, Reorder Level, Avg Cost, Stock Value, Status
- Grand total row

---

### Expenses Report PDF
```
Method:   GET
URL:      /api/reports/expenses/pdf
Auth:     Required
```
**req_param (query):**

| Param  | Type      | Description      |
|--------|-----------|------------------|
| `from` | `ISO date`| Filter from date |
| `to`   | `ISO date`| Filter to date   |

**response:** `200` — PDF download (`expenses-report-YYYY-MM-DD.pdf`)  
Portrait A4. Contains:
- Category breakdown summary (dynamic columns)
- Expenses table: #, Date, Description, Category, Account, Amount
- Grand total row

---

### Customer Balances Report PDF
```
Method:   GET
URL:      /api/reports/customer-balances/pdf
Auth:     Required
```
**req_param:** None  
**response:** `200` — PDF download (`customer-balances-YYYY-MM-DD.pdf`)  
Portrait A4. Contains:
- Summary table: Total Customers, Total Receivable, Total Overpaid
- Customers table: #, Customer Name, Phone, Address, Credit Limit, Balance, Status (`Receivable` / `Overpaid`)
- Grand total row

---

### Supplier Balances Report PDF
```
Method:   GET
URL:      /api/reports/supplier-balances/pdf
Auth:     Required
```
**req_param:** None  
**response:** `200` — PDF download (`supplier-balances-YYYY-MM-DD.pdf`)  
Portrait A4. Contains:
- Summary table: Total Suppliers, Total Payable, Total Overpaid
- Suppliers table: #, Supplier Name, Phone, Payment Terms, Tax ID, Balance, Status (`Payable` / `Overpaid`)
- Grand total row

---

### Customer Account Statement PDF
```
Method:   GET
URL:      /api/reports/customer-statement/:customerId
Auth:     Required
```
**req_param (path):**

| Param        | Type     | Description       |
|--------------|----------|-------------------|
| `customerId` | `number` | Customer ID       |

**req_param (query):**

| Param  | Type      | Description      |
|--------|-----------|------------------|
| `from` | `ISO date`| Filter from date |
| `to`   | `ISO date`| Filter to date   |

**response:** `200` — PDF download (`customer-statement-{name}-YYYY-MM-DD.pdf`) / `404` if not found  
Portrait A4. Contains:
- Customer info: Name, Phone, Address, Credit Limit
- Account summary: Total Invoiced (Debit), Total Paid (Credit), Closing Balance, Transaction counts
- Ledger table: Date, Type, Reference/Note, Debit, Credit, Running Balance
- Signature section (Customer, Accountant, Manager)

---

### Supplier Account Statement PDF
```
Method:   GET
URL:      /api/reports/supplier-statement/:supplierId
Auth:     Required
```
**req_param (path):**

| Param        | Type     | Description       |
|--------------|----------|-------------------|
| `supplierId` | `number` | Supplier ID       |

**req_param (query):**

| Param  | Type      | Description      |
|--------|-----------|------------------|
| `from` | `ISO date`| Filter from date |
| `to`   | `ISO date`| Filter to date   |

**response:** `200` — PDF download (`supplier-statement-{name}-YYYY-MM-DD.pdf`) / `404` if not found  
Portrait A4. Contains:
- Supplier info: Name, Phone, Payment Terms, Tax ID
- Account summary: Total Purchases (Debit), Total Paid (Credit), Closing Balance, Transaction counts
- Ledger table: Date, Type, Reference/Note, Debit, Credit, Running Balance
- Signature section (Supplier, Accountant, Manager)

---

## Error Responses

All endpoints return consistent error objects:

| Status | Meaning                                      |
|--------|----------------------------------------------|
| `400`  | Bad Request — missing or invalid fields      |
| `401`  | Unauthorized — missing or invalid token      |
| `403`  | Forbidden — inactive account or no permission|
| `404`  | Not Found — resource does not exist          |
| `409`  | Conflict — duplicate unique field (username, barcode, code, etc.) |
| `500`  | Internal Server Error                        |

**Error body:**
```json
{ "error": "Human-readable error message" }
```
