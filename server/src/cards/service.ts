import { z } from "zod";
import { requireMember } from "../boards/access.js";
import { byPosition, logActivity, publishActivity, toCardDto, type Actor, type CardDto } from "../boards/service.js";
import { prisma, type Tx } from "../db.js";
import { HttpError, notFound } from "../errors.js";
import { between, lockBoard, positionAfter } from "../lib/position.js";
import { publish } from "../realtime/bus.js";

export const LABELS = ["bug", "feature", "urgente", "melhoria"] as const;

const fields = {
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2000),
  assigneeId: z.string().nullable(),
  dueDate: z.iso.date().nullable(),
  labels: z.array(z.enum(LABELS)).max(LABELS.length).transform((l) => [...new Set(l)]),
};
const createSchema = z.object({
  title: fields.title,
  description: fields.description.default(""),
  assigneeId: fields.assigneeId.optional(),
  dueDate: fields.dueDate.optional(),
  labels: fields.labels.default([]),
});
const updateSchema = z.object(fields).partial();
const moveSchema = z.object({ columnId: z.string(), afterCardId: z.string().nullable(), version: z.number().int() });

export type CreateCardInput = z.input<typeof createSchema>;
export type UpdateCardInput = z.input<typeof updateSchema>;

const toDate = (d: string | null | undefined) => (d === undefined ? undefined : d === null ? null : new Date(d));

async function checkAssignee(tx: Tx, boardId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const member = await tx.boardMember.findUnique({ where: { boardId_userId: { boardId, userId: assigneeId } } });
  if (!member) throw new HttpError(400, "Responsável não é membro do quadro");
}

/** The card and its column, if the actor is a member of the card's board; 404 otherwise. */
async function cardInBoard(tx: Tx, cardId: string, userId: string) {
  const card = await tx.card.findUnique({ where: { id: cardId }, include: { column: true } });
  if (!card) throw notFound();
  await requireMember(card.column.boardId, userId, tx);
  return card;
}

export async function createCard(actor: Actor, columnId: string, input: unknown, clientMutationId?: string): Promise<CardDto> {
  const data = createSchema.parse(input);
  const { card, boardId, activity } = await prisma.$transaction(async (tx) => {
    const column = await tx.column.findUnique({ where: { id: columnId } });
    if (!column) throw notFound();
    await requireMember(column.boardId, actor.id, tx);
    await checkAssignee(tx, column.boardId, data.assigneeId);
    await lockBoard(tx, column.boardId);
    const last = (await tx.card.findMany({ where: { columnId } })).sort(byPosition).at(-1);
    const card = await tx.card.create({
      data: { ...data, columnId, dueDate: toDate(data.dueDate), position: between(last?.position ?? null, null) },
    });
    const activity = await logActivity(tx, column.boardId, actor, "card.created", { cardId: card.id, title: card.title, column: column.name });
    return { card: toCardDto(card), boardId: column.boardId, activity };
  });
  publish(boardId, { type: "card:created", payload: card, clientMutationId });
  publishActivity(boardId, activity);
  return card;
}

export async function updateCard(actor: Actor, cardId: string, input: unknown, clientMutationId?: string): Promise<CardDto> {
  const data = updateSchema.parse(input);
  const { card, boardId, activity } = await prisma.$transaction(async (tx) => {
    const current = await cardInBoard(tx, cardId, actor.id);
    const boardId = current.column.boardId;
    await checkAssignee(tx, boardId, data.assigneeId);
    const card = await tx.card.update({
      where: { id: cardId },
      data: { ...data, dueDate: toDate(data.dueDate), version: { increment: 1 } },
    });
    const activity = await logActivity(tx, boardId, actor, "card.updated", { cardId, title: card.title });
    return { card: toCardDto(card), boardId, activity };
  });
  publish(boardId, { type: "card:updated", payload: card, clientMutationId });
  publishActivity(boardId, activity);
  return card;
}

/** Last write wins: a stale `version` still applies; the response carries the current card so the client can resync. */
export async function moveCard(
  actor: Actor,
  cardId: string,
  input: { columnId: string; afterCardId: string | null; version: number },
  clientMutationId?: string,
): Promise<CardDto> {
  const data = moveSchema.parse(input);
  const { card, boardId, activity } = await prisma.$transaction(async (tx) => {
    const current = await cardInBoard(tx, cardId, actor.id);
    const boardId = current.column.boardId;
    const target = await tx.column.findFirst({ where: { id: data.columnId, boardId } });
    if (!target) throw notFound();
    await lockBoard(tx, boardId);
    const siblings = (await tx.card.findMany({ where: { columnId: target.id, id: { not: cardId } } })).sort(byPosition);
    const position = positionAfter(siblings, data.afterCardId);
    if (position === undefined) throw notFound();
    const card = await tx.card.update({
      where: { id: cardId },
      data: { columnId: target.id, position, version: { increment: 1 } },
    });
    const activity = await logActivity(tx, boardId, actor, "card.moved", {
      cardId,
      title: card.title,
      fromColumn: current.column.name,
      toColumn: target.name,
    });
    return { card: toCardDto(card), boardId, activity };
  });
  publish(boardId, { type: "card:moved", payload: card, clientMutationId });
  publishActivity(boardId, activity);
  return card;
}

export async function deleteCard(actor: Actor, cardId: string, clientMutationId?: string) {
  const { card, activity } = await prisma.$transaction(async (tx) => {
    const card = await cardInBoard(tx, cardId, actor.id);
    await tx.card.delete({ where: { id: cardId } });
    return { card, activity: await logActivity(tx, card.column.boardId, actor, "card.deleted", { cardId, title: card.title }) };
  });
  publish(card.column.boardId, { type: "card:deleted", payload: { id: cardId, columnId: card.columnId }, clientMutationId });
  publishActivity(card.column.boardId, activity);
}
