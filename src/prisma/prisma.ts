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

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

export const prisma = new PrismaClient({ adapter });
