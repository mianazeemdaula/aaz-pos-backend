import express from "express";
import cors from "cors";
import path from "path";
import apiRouter from "./routes";

const app = express();

const allowedOrigins = [
    "https://pos.aazify.com",
    "http://localhost:1420",
    "http://localhost:4002",
    "http://127.0.0.1:1420",
    "http://127.0.0.1:4002",
];

app.use(
    cors({
        origin(origin, cb) {
            // allow requests with no origin (curl, mobile apps, same-origin)
            if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
            cb(new Error("Not allowed by CORS"));
        },
        credentials: true,
    })
);
app.use(express.json());

// Serve uploaded files
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/", (_req, res) => res.json({ message: "POS API" }));
app.get("/api/health", (_req, res) => res.json({ status: "OK" }));
app.use("/api", apiRouter);

export default app;
