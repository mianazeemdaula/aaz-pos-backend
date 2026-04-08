import { Request, Response } from "express";
import { prisma } from "../prisma/prisma";
import { getPaginationParams, createPaginatedResponse } from "../utils/pagination";

export const listAdvanceBookings = async (req: Request, res: Response): Promise<void> => {
    const { page, pageSize, skip } = getPaginationParams(req);
    const where: any = {};
    if (req.query.customerId) where.customerId = parseInt(req.query.customerId as string);
    if (req.query.status) where.status = req.query.status;
    if (req.query.from || req.query.to) {
        where.deliveryDate = {};
        if (req.query.from) where.deliveryDate.gte = new Date(req.query.from as string);
        if (req.query.to) where.deliveryDate.lte = new Date(req.query.to as string);
    }

    try {
        const [bookings, total] = await Promise.all([
            prisma.advanceBooking.findMany({
                where, skip, take: pageSize,
                orderBy: { deliveryDate: "asc" },
                include: {
                    customer: { select: { id: true, name: true, phone: true } },
                    advanceBookingItems: { include: { variant: { include: { product: true } } } },
                },
            }),
            prisma.advanceBooking.count({ where }),
        ]);
        res.json(createPaginatedResponse(bookings, total, page, pageSize));
    } catch {
        res.status(500).json({ error: "Failed to fetch advance bookings" });
    }
};

export const getAdvanceBooking = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        const booking = await prisma.advanceBooking.findUnique({
            where: { id },
            include: {
                customer: true,
                advanceBookingItems: { include: { variant: { include: { product: true } } } },
            },
        });
        if (!booking) { res.status(404).json({ error: "Advance booking not found" }); return; }
        res.json(booking);
    } catch {
        res.status(500).json({ error: "Failed to fetch advance booking" });
    }
};

export const createAdvanceBooking = async (req: Request, res: Response): Promise<void> => {
    const { customerId, advancePayment, instructions, deliveryDate, totalAmount, items } = req.body;
    if (!deliveryDate || totalAmount === undefined || !items?.length) {
        res.status(400).json({ error: "deliveryDate, totalAmount and items are required" });
        return;
    }
    try {
        const booking = await prisma.advanceBooking.create({
            data: {
                customerId,
                advancePayment: advancePayment ?? 0,
                instructions,
                deliveryDate: new Date(deliveryDate),
                totalAmount,
                advanceBookingItems: {
                    create: items.map((item: any) => ({
                        variantId: item.variantId,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                    })),
                },
            },
            include: {
                customer: true,
                advanceBookingItems: { include: { variant: true } },
            },
        });
        res.status(201).json(booking);
    } catch {
        res.status(500).json({ error: "Failed to create advance booking" });
    }
};

export const updateAdvanceBookingStatus = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    const VALID_STATUS = ["PENDING", "CONFIRMED", "CANCELLED", "FULFILLED"];
    if (!status || !VALID_STATUS.includes(status)) {
        res.status(400).json({ error: `status must be one of: ${VALID_STATUS.join(", ")}` });
        return;
    }
    try {
        const booking = await prisma.advanceBooking.update({
            where: { id },
            data: { status },
        });
        res.json(booking);
    } catch {
        res.status(500).json({ error: "Failed to update booking status" });
    }
};

export const deleteAdvanceBooking = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id);
    try {
        await prisma.advanceBooking.delete({ where: { id } });
        res.json({ message: "Advance booking deleted" });
    } catch {
        res.status(500).json({ error: "Failed to delete advance booking" });
    }
};
