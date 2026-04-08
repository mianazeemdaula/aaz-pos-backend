import app from "./app";
import { seedDatabase } from "./prisma/seed";
import { migrateDatabase } from "./prisma/migrate";
import { prisma } from "./prisma/prisma";
import { checkForUpdates } from "./utils/auto-updater";
// https://o.fbr.gov.pk/newcu/tariff/ByDescriptionSearch.asp
const PORT = process.env.PORT || 3000;

async function checkDatabaseConnection(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("✔ Database connection established.");
  } catch (error) {
    console.error("✖ Database connection failed:", error);
    process.exit(1);
  }
}

async function bootstrap() {
  const shouldMigrate = process.argv.includes("--migrate");
  const shouldSeed = process.argv.includes("--seed");

  if (shouldMigrate || shouldSeed) {
    try {
      if (shouldMigrate) {
        await migrateDatabase();
      }

      if (shouldSeed) {
        await seedDatabase();
        console.log("Seeding completed");
      }
    } catch (error) {
      console.error("Database setup failed:", error);
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  // Check for a new .exe release before starting the HTTP server.
  // This call exits the process (and hands off to the updater bat) only when
  // a new version was found and downloaded successfully.
  await checkForUpdates();

  await checkDatabaseConnection();

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

void bootstrap();
