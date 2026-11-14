import { prisma } from "../db.js";
import { publish, revokeMembership } from "../realtime/bus.js";

const TTL_MS = 24 * 60 * 60 * 1000;

/** Deletes guests older than 24 h. The schema cascades their boards/memberships and nulls assignee/actorId. */
export async function cleanupGuests(now: Date): Promise<number> {
  const where = { isGuest: true, createdAt: { lt: new Date(now.getTime() - TTL_MS) } };
  const owned = await prisma.board.findMany({ where: { owner: where }, include: { members: true } });
  const { count } = await prisma.user.deleteMany({ where });
  // Members of those boards who are online right now see them disappear.
  for (const board of owned) {
    publish(board.id, { type: "board:deleted", payload: { boardId: board.id } });
    for (const m of board.members) revokeMembership(board.id, m.userId);
  }
  return count;
}

export function startGuestCleanup(intervalMs = 60 * 60 * 1000) {
  const run = () => cleanupGuests(new Date()).catch((e) => console.error("guest cleanup failed", e));
  void run();
  setInterval(run, intervalMs).unref();
}
