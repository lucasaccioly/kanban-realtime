import { prisma, type Tx } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { publish } from "../realtime/bus.js";

export type Actor = { id: string; name: string };

export type CardDto = {
  id: string;
  columnId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: Date | null;
  labels: string[];
  position: string;
  version: number;
  updatedAt: Date;
};
export type ActivityDto = { id: string; actorName: string; type: string; payload: unknown; createdAt: Date };
export type BoardState = {
  board: { id: string; name: string; ownerId: string; inviteToken: string | null; isGuestDemo: boolean; botPaused: boolean };
  members: { id: string; name: string; isBot: boolean }[];
  columns: { id: string; name: string; position: string; cards: CardDto[] }[];
  activity: ActivityDto[];
};

export const toCardDto = (c: CardDto): CardDto => ({
  id: c.id,
  columnId: c.columnId,
  title: c.title,
  description: c.description,
  assigneeId: c.assigneeId,
  dueDate: c.dueDate,
  labels: c.labels,
  position: c.position,
  version: c.version,
  updatedAt: c.updatedAt,
});

export const toActivityDto = (a: ActivityDto): ActivityDto => ({
  id: a.id,
  actorName: a.actorName,
  type: a.type,
  payload: a.payload,
  createdAt: a.createdAt,
});

// Fractional keys sort by code point; sort in JS so the result does not depend on the database collation.
export const byPosition = (a: { position: string }, b: { position: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

export async function getBoardState(boardId: string, tx: Tx = prisma): Promise<BoardState> {
  const b = await tx.board.findUniqueOrThrow({
    where: { id: boardId },
    include: {
      members: { include: { user: true }, orderBy: { joinedAt: "asc" } },
      columns: { include: { cards: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  return {
    board: { id: b.id, name: b.name, ownerId: b.ownerId, inviteToken: b.inviteToken, isGuestDemo: b.isGuestDemo, botPaused: b.botPaused },
    members: b.members.map(({ user }) => ({ id: user.id, name: user.name, isBot: user.isBot })),
    columns: b.columns.sort(byPosition).map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
      cards: c.cards.sort(byPosition).map(toCardDto),
    })),
    activity: b.activities.map(toActivityDto),
  };
}

/** Writes an activity row inside the caller's transaction; the caller publishes it after commit. */
export async function logActivity(tx: Tx, boardId: string, actor: Actor, type: string, payload: Prisma.InputJsonValue) {
  const a = await tx.activity.create({ data: { boardId, actorId: actor.id, actorName: actor.name, type, payload } });
  return toActivityDto(a);
}

export const publishActivity = (boardId: string, activity: ActivityDto) =>
  publish(boardId, { type: "activity:new", payload: activity });
