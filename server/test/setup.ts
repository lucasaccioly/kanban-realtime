import { config } from "dotenv";
import { beforeEach } from "vitest";

config({ quiet: true });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.JWT_SECRET ??= "test-secret";

const { prisma } = await import("../src/db.js");

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Activity", "Card", "Column", "BoardMember", "Board", "AiUsage", "User" CASCADE',
  );
}

beforeEach(resetDb);

const { resetRateLimits } = await import("../src/lib/rateLimit.js");
beforeEach(resetRateLimits);

const { clearRecorded } = await import("../src/realtime/bus.js");
beforeEach(clearRecorded);
