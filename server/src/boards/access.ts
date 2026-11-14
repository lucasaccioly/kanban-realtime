import { prisma, type Tx } from "../db.js";
import { HttpError, notFound } from "../errors.js";

/** The board, if `userId` is a member; 404 otherwise (never reveal that the board exists). */
export async function requireMember(boardId: string, userId: string, tx: Tx = prisma) {
  const board = await tx.board.findFirst({ where: { id: boardId, members: { some: { userId } } } });
  if (!board) throw notFound();
  return board;
}

/** Members already know the board exists, so a non-owner member gets 403 instead of 404. */
export async function requireOwner(boardId: string, userId: string, tx: Tx = prisma) {
  const board = await requireMember(boardId, userId, tx);
  if (board.ownerId !== userId) throw new HttpError(403, "Apenas o dono pode fazer isso");
  return board;
}
