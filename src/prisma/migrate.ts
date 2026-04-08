import fs from "fs";
import path from "path";
import { prisma } from "./prisma";

type MigrationDir = {
    name: string;
    sqlPath: string;
};

function getMigrationsRootPath() {
    const isPkg = typeof (process as any).pkg !== "undefined";

    if (isPkg) {
        return path.join(path.dirname(process.execPath), "prisma", "migrations");
    }

    return path.join(__dirname, "..", "..", "src", "prisma", "migrations");
}

function getMigrationDirectories(rootPath: string): MigrationDir[] {
    if (!fs.existsSync(rootPath)) {
        return [];
    }

    return fs
        .readdirSync(rootPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
            name: entry.name,
            sqlPath: path.join(rootPath, entry.name, "migration.sql"),
        }))
        .filter((entry) => fs.existsSync(entry.sqlPath))
        .sort((a, b) => a.name.localeCompare(b.name));
}

export async function migrateDatabase() {
    const migrationsRootPath = getMigrationsRootPath();
    const migrationDirs = getMigrationDirectories(migrationsRootPath);

    if (migrationDirs.length === 0) {
        console.log(`No migration files found in: ${migrationsRootPath}`);
        return;
    }

    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

    for (const migration of migrationDirs) {
        const alreadyApplied = await prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM app_migrations WHERE name = ${migration.name}
    `;

        if (alreadyApplied.length > 0) {
            console.log(`Skipping already applied migration: ${migration.name}`);
            continue;
        }

        const sql = fs.readFileSync(migration.sqlPath, "utf8");

        if (!sql.trim()) {
            console.log(`Skipping empty migration: ${migration.name}`);
            continue;
        }

        console.log(`Applying migration: ${migration.name}`);
        await prisma.$executeRawUnsafe(sql);
        await prisma.$executeRaw`
      INSERT INTO app_migrations (name) VALUES (${migration.name})
    `;
    }

    console.log("Migrations completed");
}
