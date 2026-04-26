import express from "express";
import cors from "cors";
import path from "path";
import apiRouter from "./routes";

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || "*";
const listedOrigins = corsOrigin.split(",").map((origin) => origin.trim());

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);

        // Allow exact matches from env
        if (listedOrigins.includes(origin)) {
            return callback(null, true);
        }

        // Allow local network: 192.168.15.*
        if (/^http:\/\/192\.168\.15\.\d+(:\d+)?$/.test(origin)) {
            return callback(null, true);
        }

        // Optional: allow all localhost variants
        if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            return callback(null, true);
        }

        return callback(new Error("Not allowed by CORS"));
    }
}));
app.use(express.json());

// Serve uploaded files
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/", (_req, res) => res.json({ message: "POS API" }));
app.get("/api/health", (_req, res) => res.json({ status: "OK" }));
app.use("/api", apiRouter);

export default app;
