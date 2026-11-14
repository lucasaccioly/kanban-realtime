import { generateKeyBetween } from "fractional-indexing";
import type { Request } from "express";
import type { Tx } from "../db.js";

/** Fractional-index key strictly between two neighbours (null = open end). */
export const between = (before: string | null, after: string | null): string => generateKeyBetween(before, after);

/** Key for an item placed right after `afterId` (null = first) among `siblings` sorted by position. */
export function positionAfter(siblings: { id: string; position: string }[], afterId: string | null): string | undefined {
  if (afterId === null) return between(null, siblings[0]?.position ?? null);
  const i = siblings.findIndex((s) => s.id === afterId);
  if (i < 0) return undefined;
  return between(siblings[i].position, siblings[i + 1]?.position ?? null);
}

/** Serializes position-changing writes on one board, so two concurrent moves never compute the same key. */
export async function lockBoard(tx: Tx, boardId: string) {
  await tx.$queryRaw`SELECT 1 FROM "Board" WHERE id = ${boardId} FOR UPDATE`;
}

export const clientMutationId = (req: Request) => req.header("x-client-mutation-id")?.slice(0, 64) || undefined;
