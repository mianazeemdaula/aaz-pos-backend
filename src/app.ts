import express from "express";
import cors from "cors";
import path from "path";
import apiRouter from "./routes";

const app = express();

app.use(cors());
app.use(express.json());

// Serve uploaded files
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/", (_req, res) => res.json({ message: "POS API" }));
app.get("/api/health", (_req, res) => res.json({ status: "OK" }));
app.use("/api", apiRouter);

export default app;
