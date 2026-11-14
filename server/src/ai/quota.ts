import { prisma, type Tx } from "../db.js";

const USER_LIMIT = 5;
const globalLimit = () => Number(process.env.AI_GLOBAL_DAILY ?? 200);

export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/** Atomic "increment if below limit": returns false (and changes nothing) when the scope is already at its limit. */
async function consume(tx: Tx, day: string, scope: string, limit: number) {
  const rows = await tx.$queryRaw<{ count: number }[]>`
    INSERT INTO "AiUsage" (day, scope, count) VALUES (${day}::date, ${scope}, 1)
    ON CONFLICT (day, scope) DO UPDATE SET count = "AiUsage".count + 1 WHERE "AiUsage".count < ${limit}
    RETURNING count`;
  return rows.length > 0 && limit > 0;
}

export async function tryConsume(userId: string, day: string): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await consume(tx, day, userId, USER_LIMIT))) throw new QuotaExceeded();
      if (!(await consume(tx, day, "global", globalLimit()))) throw new QuotaExceeded(); // rolls back the user increment
      return true;
    });
  } catch (e) {
    if (e instanceof QuotaExceeded) return false;
    throw e;
  }
}

export async function refund(userId: string, day: string) {
  await prisma.$executeRaw`
    UPDATE "AiUsage" SET count = count - 1
    WHERE day = ${day}::date AND scope IN (${userId}, 'global') AND count > 0`;
}

class QuotaExceeded extends Error {}
