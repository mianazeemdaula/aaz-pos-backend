import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Handle .env file loading for both dev and exe environments
const isDev = process.env.NODE_ENV !== 'production';
const isPkg = typeof (process as any).pkg !== 'undefined';

if (isPkg) {
  // When running as exe, look for .env in the exe directory
  const exeDir = path.dirname(process.execPath);
  const envPath = path.join(exeDir, '.env');

  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    console.warn(`Warning: .env file not found at ${envPath}`);
    console.warn('Please create a .env file in the same directory as the executable.');
  }
} else {
  // Normal development environment
  dotenv.config();
}

import { PrismaClient } from "../generated/client/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Pool sizing. node-postgres defaults to 10 connections, and the dashboard
// alone fires ~20 queries in one Promise.all, so a single dashboard load could
// occupy the whole pool and stall every other request behind it — the stress
// ramp showed dashboard throughput pinned at ~2.5 req/s no matter the
// concurrency, while latency grew linearly. Postgres here allows 100
// connections; 25 leaves ample headroom for psql, backups and pgAdmin.
const POOL_MAX = Number(process.env.DB_POOL_MAX || 25);

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: POOL_MAX,
  // Hand back idle connections rather than holding all 25 open forever.
  idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_MS || 30_000),
  // Fail fast instead of hanging the UI forever when the pool is exhausted.
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10_000),
  // A runaway report must not pin a connection indefinitely.
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 60_000),
});

export const prisma = new PrismaClient({ adapter });
