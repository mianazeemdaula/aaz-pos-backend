import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";
import { computeEmployeeBalance } from "../utils/balance";

// ---- EMPLOYEES ----

export const listEmployees = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip, q } = getPaginationParams(req);
    const where: any = {};
    if (req.query.active !== undefined) where.active = req.query.active === "true";
    if (q) {
        where.OR = [
            { name: { contains: q, mode: "insensitive" } },
            { designation: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
            { cnic: { contains: q, mode: "insensitive" } },
        ];
    }

    try {
        const [employees, total] = await Promise.all([
            prisma.employee.findMany({
                where, skip, take: pageSize,
                orderBy: { createdAt: "desc" },
            }),
            prisma.employee.count({ where }),
        ]);

        // Compute balances and pending advances count for each employee
        const withBalances = await Promise.all(
            employees.map(async (e) => {
                const balance = await computeEmployeeBalance(e.id);
                const pendingAdvancesCount = await prisma.employeeAdvance.count({
                    where: { employeeId: e.id, status: "PENDING" },
                });
                return {
                    ...e,
                    balance,
                    pendingAdvancesCount,
                };
            })
        );

        res.json(createPaginatedResponse(withBalances, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch employees" });
    }
};

export const getEmployee = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const employee = await prisma.employee.findUnique({
            where: { id },
            include: {
                ledger: { orderBy: { createdAt: "desc" }, take: 20 },
                salarySlips: { orderBy: { createdAt: "desc" }, take: 12 },
                advances: { orderBy: { date: "desc" }, take: 10 },
            },
        });
        if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }

        const balance = await computeEmployeeBalance(id);
        const pendingAdvancesCount = await prisma.employeeAdvance.count({
            where: { employeeId: id, status: "PENDING" },
        });
        res.json({ ...employee, balance, pendingAdvancesCount });
    } catch {
        res.status(500).json({ error: "Failed to fetch employee" });
    }
};

export const createEmployee = async (req: Request, res: Response): Promise<void> => {
    const { name, phone, cnic, joiningDate, designation, baseSalary, advanceLimit, active } = req.body;
    if (!name || !joiningDate || baseSalary === undefined) {
        res.status(400).json({ error: "name, joiningDate and baseSalary are required" });
        return;
    }
    try {
        const employee = await prisma.employee.create({
            data: {
                name, phone: phone || null, cnic: cnic || null,
                designation: designation || null, baseSalary: Number(baseSalary),
                joiningDate: new Date(joiningDate),
                advanceLimit: advanceLimit ?? 0,
                active: active ?? true,
            },
        });
        res.status(201).json({ ...employee, balance: 0 });
    } catch (err: any) {
        console.error("createEmployee error:", err);
        res.status(500).json({ error: err?.message || "Failed to create employee" });
    }
};

export const updateEmployee = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { name, phone, cnic, joiningDate, designation, baseSalary, advanceLimit, active } = req.body;
    try {
        const employee = await prisma.employee.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(phone !== undefined && { phone: phone || null }),
                ...(cnic !== undefined && { cnic: cnic || null }),
                ...(designation !== undefined && { designation: designation || null }),
                ...(baseSalary !== undefined && { baseSalary: Number(baseSalary) }),
                ...(advanceLimit !== undefined && { advanceLimit: Number(advanceLimit) }),
                ...(active !== undefined && { active }),
                ...(joiningDate && { joiningDate: new Date(joiningDate) }),
            },
        });
        res.json(employee);
    } catch (err: any) {
        console.error("updateEmployee error:", err);
        if (err?.code === "P2025") {
            res.status(404).json({ error: "Employee not found" });
        } else {
            res.status(500).json({ error: err?.message || "Failed to update employee" });
        }
    }
};

export const deleteEmployee = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        await prisma.employee.delete({ where: { id } });
        res.json({ message: "Employee deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete employee — it may have associated records" });
    }
};

// ---- EMPLOYEE LEDGER ----

export const listEmployeeLedger = async (req: Request, res: Response): Promise<void> => {
    const employeeId = parseInt(req.params.id);
    const { page, pageSize, skip } = getPaginationParams(req);
    try {
        const [entries, total] = await Promise.all([
            prisma.employeeLedger.findMany({
                where: { employeeId },
                skip, take: pageSize,
                orderBy: { createdAt: "desc" },
            }),
            prisma.employeeLedger.count({ where: { employeeId } }),
        ]);
        res.json(createPaginatedResponse(entries, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch employee ledger" });
    }
};

// ---- EMPLOYEE ADVANCES ----

export const listEmployeeAdvances = async (req: Request, res: Response): Promise<void> => {
    const employeeId = parseInt(req.params.id);
    const { page, pageSize, skip } = getPaginationParams(req);
    const where: any = { employeeId };
    if (req.query.status) where.status = req.query.status;
    if (req.query.month) where.month = parseInt(req.query.month as string);
    if (req.query.year) where.year = parseInt(req.query.year as string);

    try {
        const [advances, total] = await Promise.all([
            prisma.employeeAdvance.findMany({
                where, skip, take: pageSize,
                orderBy: { date: "desc" },
                include: { account: true },
            }),
            prisma.employeeAdvance.count({ where }),
        ]);
        res.json(createPaginatedResponse(advances, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch advances" });
    }
};

export const createEmployeeAdvance = async (req: Request, res: Response): Promise<void> => {
    const employeeId = parseInt(req.params.id);
    const { amount, accountId, reason, month, year } = req.body;

    if (!amount || !accountId || !month || !year) {
        res.status(400).json({ error: "amount, accountId, month and year are required" });
        return;
    }

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    if (year < currentYear || (year === currentYear && month < currentMonth)) {
        res.status(400).json({ error: "Advance cannot be created for a previous month" });
        return;
    }

    try {
        const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
        if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }

        if (employee.advanceLimit > 0) {
            // Check existing pending and approved advances
            const existing = await prisma.employeeAdvance.aggregate({
                where: { employeeId, status: { in: ["PENDING", "APPROVED"] } },
                _sum: { amount: true },
            });
            const currentTotal = (existing._sum.amount ?? 0) + amount;
            if (currentTotal > employee.advanceLimit) {
                res.status(400).json({ error: `Advance exceeds limit. Remaining: ${employee.advanceLimit - (existing._sum.amount ?? 0)}` });
                return;
            }
        }

        // PENDING advances do not affect employee ledger balance until approved
        const advance = await prisma.employeeAdvance.create({
            data: { employeeId, amount, accountId, reason, month, year, status: "PENDING" },
            include: { account: true },
        });

        res.status(201).json(advance);
    } catch (err: any) {
        res.status(500).json({ error: "Failed to create advance" });
    }
};

// ---- ADVANCE ACTIONS ----

export const approveAdvance = async (req: Request, res: Response): Promise<void> => {
    const advanceId = parseInt(req.params.advId);
    try {
        const advance = await prisma.employeeAdvance.findUnique({ where: { id: advanceId } });
        if (!advance) { res.status(404).json({ error: "Advance not found" }); return; }
        if (advance.status !== "PENDING") {
            res.status(400).json({ error: `Cannot approve advance with status ${advance.status}` });
            return;
        }

        // Approve updates status to APPROVED and records the ledger entry (cash disbursed)
        const [updated] = await prisma.$transaction([
            prisma.employeeAdvance.update({
                where: { id: advanceId },
                data: { status: "APPROVED" },
                include: { account: true },
            }),
            prisma.employeeLedger.create({
                data: {
                    employeeId: advance.employeeId,
                    type: "ADVANCE",
                    amount: advance.amount,
                    referenceId: advance.id,
                    reference: `ADV-${advance.id}`,
                    note: advance.reason || "Employee Advance Approved",
                },
            }),
        ]);
        res.json(updated);
    } catch (err: any) {
        res.status(500).json({ error: "Failed to approve advance" });
    }
};

export const rejectAdvance = async (req: Request, res: Response): Promise<void> => {
    const advanceId = parseInt(req.params.advId);
    try {
        const advance = await prisma.employeeAdvance.findUnique({ where: { id: advanceId } });
        if (!advance) { res.status(404).json({ error: "Advance not found" }); return; }
        if (advance.status !== "PENDING" && advance.status !== "APPROVED") {
            res.status(400).json({ error: `Cannot reject advance with status ${advance.status}` });
            return;
        }

        const queries: any[] = [
            prisma.employeeAdvance.update({
                where: { id: advanceId },
                data: { status: "WAIVED" },
                include: { account: true },
            })
        ];

        // Only reverse if it was already approved and entered the ledger
        if (advance.status === "APPROVED") {
            queries.push(
                prisma.employeeLedger.create({
                    data: {
                        employeeId: advance.employeeId,
                        type: "ADJUSTMENT_CR",
                        amount: advance.amount,
                        referenceId: advance.id,
                        reference: `ADV-REJECT-${advanceId}`,
                        note: "Advance rejected — reversed",
                    },
                })
            );
        }

        const [updated] = await prisma.$transaction(queries);
        res.json(updated);
    } catch {
        res.status(500).json({ error: "Failed to reject advance" });
    }
};

export const repayAdvance = async (req: Request, res: Response): Promise<void> => {
    const advanceId = parseInt(req.params.advId);
    try {
        const advance = await prisma.employeeAdvance.findUnique({ where: { id: advanceId } });
        if (!advance) { res.status(404).json({ error: "Advance not found" }); return; }
        if (advance.status !== "APPROVED") {
            res.status(400).json({ error: `Cannot repay advance with status ${advance.status}. Must be APPROVED first.` });
            return;
        }

        const [updated] = await prisma.$transaction([
            prisma.employeeAdvance.update({
                where: { id: advanceId },
                data: { status: "REPAID" },
                include: { account: true },
            }),
            prisma.employeeLedger.create({
                data: {
                    employeeId: advance.employeeId,
                    type: "ADVANCE_REPAID",
                    amount: advance.amount,
                    referenceId: advance.id,
                    reference: `ADV-REPAY-${advanceId}`,
                    note: `Advance repaid`,
                },
            }),
        ]);

        res.json(updated);
    } catch {
        res.status(500).json({ error: "Failed to repay advance" });
    }
};

export const waiveAdvance = async (req: Request, res: Response): Promise<void> => {
    const advanceId = parseInt(req.params.advId);
    try {
        const advance = await prisma.employeeAdvance.findUnique({ where: { id: advanceId } });
        if (!advance) { res.status(404).json({ error: "Advance not found" }); return; }
        if (advance.status !== "PENDING" && advance.status !== "APPROVED") {
            res.status(400).json({ error: `Cannot waive advance with status ${advance.status}` });
            return;
        }

        const queries: any[] = [
            prisma.employeeAdvance.update({
                where: { id: advanceId },
                data: { status: "WAIVED" },
                include: { account: true },
            })
        ];

        // Only reverse if it was already approved and entered the ledger
        if (advance.status === "APPROVED") {
            queries.push(
                prisma.employeeLedger.create({
                    data: {
                        employeeId: advance.employeeId,
                        type: "ADJUSTMENT_CR",
                        amount: advance.amount,
                        referenceId: advance.id,
                        reference: `ADV-WAIVE-${advanceId}`,
                        note: "Advance waived off",
                    },
                })
            );
        }

        const [updated] = await prisma.$transaction(queries);
        res.json(updated);
    } catch {
        res.status(500).json({ error: "Failed to waive advance" });
    }
};
