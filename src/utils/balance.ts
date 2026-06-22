import { prisma } from "../prisma/prisma";

// ── Customer Balance ─────────────────────────────────────────────────────────

/**
 * Compute a single customer's balance from their ledger.
 * Balance = sum(debit) - sum(credit).
 * Positive = customer owes us.
 */
export async function computeCustomerBalance(customerId: number): Promise<number> {
    const agg = await prisma.customerLedger.aggregate({
        where: { customerId },
        _sum: { debit: true, credit: true },
    });
    return (agg._sum.debit ?? 0) - (agg._sum.credit ?? 0);
}

/**
 * Compute balances for ALL customers in a single pass.
 * Returns Map<customerId, balance>.
 */
export async function computeAllCustomerBalances(): Promise<Map<number, number>> {
    const groups = await prisma.customerLedger.groupBy({
        by: ["customerId"],
        _sum: { debit: true, credit: true },
    });
    const map = new Map<number, number>();
    for (const g of groups) {
        map.set(g.customerId, (g._sum.debit ?? 0) - (g._sum.credit ?? 0));
    }
    return map;
}

// ── Supplier Balance ─────────────────────────────────────────────────────────

/**
 * Compute a single supplier's balance from their ledger.
 * Balance = sum(debit) - sum(credit).
 * Positive = we owe them.
 */
export async function computeSupplierBalance(supplierId: number): Promise<number> {
    const agg = await prisma.supplierLedger.aggregate({
        where: { supplierId },
        _sum: { debit: true, credit: true },
    });
    return (agg._sum.debit ?? 0) - (agg._sum.credit ?? 0);
}

/**
 * Compute balances for ALL suppliers in a single pass.
 * Returns Map<supplierId, balance>.
 */
export async function computeAllSupplierBalances(): Promise<Map<number, number>> {
    const groups = await prisma.supplierLedger.groupBy({
        by: ["supplierId"],
        _sum: { debit: true, credit: true },
    });
    const map = new Map<number, number>();
    for (const g of groups) {
        map.set(g.supplierId, (g._sum.debit ?? 0) - (g._sum.credit ?? 0));
    }
    return map;
}

// ── Employee Balance ─────────────────────────────────────────────────────────

/**
 * Employee ledger types that INCREASE the balance (company owes employee more).
 */
const EMPLOYEE_CREDIT_TYPES = ["SALARY", "BONUS", "ADVANCE_REPAID", "ADJUSTMENT_CR", "OPENING_BALANCE"];
/**
 * Employee ledger types that DECREASE the balance (employee owes company).
 */
const EMPLOYEE_DEBIT_TYPES = ["SALARY_PAID", "ADVANCE", "DEDUCTION", "ADJUSTMENT_DR"];

/**
 * Compute a single employee's balance from their ledger.
 * Positive = company owes employee. Negative = employee owes company.
 */
export async function computeEmployeeBalance(employeeId: number): Promise<number> {
    const entries = await prisma.employeeLedger.findMany({
        where: { employeeId },
        select: { type: true, amount: true },
    });
    let balance = 0;
    for (const e of entries) {
        if (EMPLOYEE_CREDIT_TYPES.includes(e.type)) {
            balance += e.amount;
        } else if (EMPLOYEE_DEBIT_TYPES.includes(e.type)) {
            balance -= e.amount;
        }
    }
    return balance;
}

// ── Running Balances ─────────────────────────────────────────────────────────

/**
 * Given an array of customer/supplier ledger entries (ordered by createdAt asc),
 * attach a computed `balance` field to each based on cumulative debit - credit.
 */
export function computeRunningBalances<T extends { debit: number; credit: number }>(
    entries: T[],
): (T & { balance: number })[] {
    let running = 0;
    return entries.map((e) => {
        running += e.debit - e.credit;
        return { ...e, balance: running };
    });
}

/**
 * Given an array of employee ledger entries (ordered by createdAt asc),
 * attach a computed `balance` field based on type-driven direction.
 */
export function computeEmployeeRunningBalances<T extends { type: string; amount: number }>(
    entries: T[],
): (T & { balance: number })[] {
    let running = 0;
    return entries.map((e) => {
        if (EMPLOYEE_CREDIT_TYPES.includes(e.type)) {
            running += e.amount;
        } else if (EMPLOYEE_DEBIT_TYPES.includes(e.type)) {
            running -= e.amount;
        }
        return { ...e, balance: running };
    });
}
