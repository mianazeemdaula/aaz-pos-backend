import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

export const listSalarySlips = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip } = getPaginationParams(req);
    const where: any = {};
    if (req.query.employeeId) where.employeeId = parseInt(req.query.employeeId as string);
    if (req.query.status) where.status = req.query.status;
    if (req.query.year) where.year = parseInt(req.query.year as string);
    if (req.query.month) where.month = parseInt(req.query.month as string);

    try {
        const [slips, total] = await Promise.all([
            prisma.salarySlip.findMany({
                where, skip, take: pageSize,
                orderBy: [{ year: "desc" }, { month: "desc" }],
                include: {
                    employee: { select: { id: true, name: true, designation: true } },
                    account: { select: { id: true, name: true } },
                },
            }),
            prisma.salarySlip.count({ where }),
        ]);
        res.json(createPaginatedResponse(slips, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch salary slips" });
    }
};

export const getSalarySlip = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const slip = await prisma.salarySlip.findUnique({
            where: { id },
            include: {
                employee: { select: { id: true, name: true, designation: true } },
                account: { select: { id: true, name: true } },
                advances: true,
            },
        });
        if (!slip) { res.status(404).json({ error: "Salary slip not found" }); return; }
        res.json(slip);
    } catch {
        res.status(500).json({ error: "Failed to fetch salary slip" });
    }
};

export const generateSalarySlip = async (req: Request, res: Response): Promise<void> => {
    const { employeeId, year, month, bonus = 0, otherDeductions = 0, accountId, note } = req.body;

    if (!employeeId || !year || !month) {
        res.status(400).json({ error: "employeeId, year and month are required" });
        return;
    }

    try {
        const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
        if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }

        // Check if slip already exists for this month
        const existing = await prisma.salarySlip.findUnique({
            where: { employeeId_year_month: { employeeId, year, month } },
        });
        if (existing) {
            res.status(409).json({ error: "Salary slip already exists for this month" });
            return;
        }

        // Get all PENDING advances for this employee for the given month/year
        const pendingAdvances = await prisma.employeeAdvance.findMany({
            where: { employeeId, status: "PENDING", month, year },
        });
        const totalAdvances = pendingAdvances.reduce((sum, a) => sum + a.amount, 0);
        const netPayable = employee.baseSalary + bonus - totalAdvances - otherDeductions;

        const result = await prisma.$transaction(async (tx) => {
            const slip = await tx.salarySlip.create({
                data: {
                    employeeId, year, month, accountId, note,
                    baseSalary: employee.baseSalary,
                    bonus,
                    totalAdvances,
                    otherDeductions,
                    netPayable,
                    status: "DRAFT",
                },
            });

            // Mark all pending advances as DEDUCTED
            if (pendingAdvances.length > 0) {
                await tx.employeeAdvance.updateMany({
                    where: { id: { in: pendingAdvances.map((a) => a.id) } },
                    data: { status: "DEDUCTED", deductedIn: slip.id },
                });
            }

            // Add ledger entry for salary earned
            const newBalance = employee.balance + employee.baseSalary + bonus;
            await tx.employeeLedger.create({
                data: {
                    employeeId, type: "SALARY",
                    amount: employee.baseSalary + bonus,
                    balance: newBalance,
                    referenceId: slip.id,
                    reference: `SAL-${year}-${String(month).padStart(2, "0")}`,
                    note: `Salary for ${year}-${String(month).padStart(2, "0")}`,
                },
            });
            await tx.employee.update({ where: { id: employeeId }, data: { balance: newBalance } });

            return slip;
        });

        res.status(201).json(result);
    } catch {
        res.status(500).json({ error: "Failed to generate salary slip" });
    }
};

export const approveSalarySlip = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const slip = await prisma.salarySlip.findUnique({ where: { id } });
        if (!slip) { res.status(404).json({ error: "Salary slip not found" }); return; }
        if (slip.status !== "DRAFT") {
            res.status(400).json({ error: "Only DRAFT slips can be approved" });
            return;
        }
        const updated = await prisma.salarySlip.update({
            where: { id },
            data: { status: "APPROVED" },
        });
        res.json(updated);
    } catch {
        res.status(500).json({ error: "Failed to approve salary slip" });
    }
};

export const paySalarySlip = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { accountId } = req.body;

    try {
        const slip = await prisma.salarySlip.findUnique({
            where: { id },
            include: { employee: true },
        });
        if (!slip) { res.status(404).json({ error: "Salary slip not found" }); return; }
        if (slip.status === "PAID") {
            res.status(400).json({ error: "This salary slip has already been paid" });
            return;
        }
        if (slip.status === "CANCELLED") {
            res.status(400).json({ error: "Cannot pay a cancelled salary slip" });
            return;
        }
        if (!accountId) {
            res.status(400).json({ error: "accountId is required to pay a salary slip" });
            return;
        }

        const result = await prisma.$transaction(async (tx) => {
            const updated = await tx.salarySlip.update({
                where: { id },
                data: { status: "PAID", paidDate: new Date(), accountId },
            });

            // Ledger entry for salary disbursement
            const newBalance = slip.employee.balance - slip.netPayable;
            await tx.employeeLedger.create({
                data: {
                    employeeId: slip.employeeId, type: "SALARY_PAID",
                    amount: slip.netPayable,
                    balance: newBalance,
                    referenceId: slip.id,
                    reference: `SAL-${slip.year}-${String(slip.month).padStart(2, "0")}`,
                },
            });
            await tx.employee.update({ where: { id: slip.employeeId }, data: { balance: newBalance } });

            return updated;
        });

        res.json(result);
    } catch {
        res.status(500).json({ error: "Failed to pay salary slip" });
    }
};

export const cancelSalarySlip = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const slip = await prisma.salarySlip.findUnique({ where: { id } });
        if (!slip) { res.status(404).json({ error: "Salary slip not found" }); return; }
        if (slip.status === "PAID") {
            res.status(400).json({ error: "Cannot cancel a PAID salary slip" });
            return;
        }
        const updated = await prisma.salarySlip.update({
            where: { id },
            data: { status: "CANCELLED" },
        });
        res.json(updated);
    } catch {
        res.status(500).json({ error: "Failed to cancel salary slip" });
    }
};
