import { Router } from "express";
import {
    listAdvanceBookings, getAdvanceBooking, createAdvanceBooking,
    updateAdvanceBookingStatus, deleteAdvanceBooking,
} from "../controllers/advance-bookings.controller";

const router = Router();

router.get("/", listAdvanceBookings);
router.get("/:id", getAdvanceBooking);
router.post("/", createAdvanceBooking);
router.patch("/:id/status", updateAdvanceBookingStatus);
router.delete("/:id", deleteAdvanceBooking);

export default router;
