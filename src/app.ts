import express from "express";
import cors from "cors";
import path from "path";
import apiRouter from "./routes";

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || "*";
const listedOrigins = corsOrigin.split(",").map((origin) => origin.trim());

// app.use((req, _res, next) => {
// 	console.log("[request-origin]", req.headers.origin ?? "no-origin", req.method, req.originalUrl);
// 	next();
// });

app.use(cors({ origin: listedOrigins })); // Allow all origins for now; we can lock this down later if needed
app.use(express.json());

// Serve uploaded files
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/", (_req, res) => res.json({ message: "POS API" }));
app.get("/api/health", (_req, res) => res.json({ status: "OK" }));
app.use("/api", apiRouter);

export default app;
