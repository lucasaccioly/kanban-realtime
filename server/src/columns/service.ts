import { z } from "zod";
import { requireMember } from "../boards/access.js";
import { byPosition, logActivity, publishActivity, type Actor } from "../boards/service.js";
import { prisma, type Tx } from "../db.js";
import { notFound } from "../errors.js";
import { between, lockBoard, positionAfter } from "../lib/position.js";
import { publish } from "../realtime/bus.js";

const name = z.string().trim().min(1).max(60);
const updateSchema = z.object({ name: name.optional(), afterColumnId: z.string().nullable().optional() });

const columnDto = (c: { id: string; name: string; position: string }) => ({ id: c.id, name: c.name, position: c.position });

async function columnInBoard(tx: Tx, columnId: string, userId: string) {
  const column = await tx.column.findUnique({ where: { id: columnId } });
  if (!column) throw notFound();
  await requireMember(column.boardId, userId, tx);
  return column;
}

export async function createColumn(actor: Actor, boardId: string, rawName: unknown, clientMutationId?: string) {
  const columnName = name.parse(rawName);
  const { column, activity } = await prisma.$transaction(async (tx) => {
    await requireMember(boardId, actor.id, tx);
    await lockBoard(tx, boardId);
    const last = (await tx.column.findMany({ where: { boardId } })).sort(byPosition).at(-1);
    const column = await tx.column.create({ data: { boardId, name: columnName, position: between(last?.position ?? null, null) } });
    return { column, activity: await logActivity(tx, boardId, actor, "column.created", { name: columnName }) };
  });
  const dto = { ...columnDto(column), cards: [] };
  publish(boardId, { type: "column:created", payload: dto, clientMutationId });
  publishActivity(boardId, activity);
  return dto;
}

export async function updateColumn(actor: Actor, columnId: string, input: unknown, clientMutationId?: string) {
  const data = updateSchema.parse(input);
  const { column, activity } = await prisma.$transaction(async (tx) => {
    const current = await columnInBoard(tx, columnId, actor.id);
    let position = current.position;
    if (data.afterColumnId !== undefined) {
      await lockBoard(tx, current.boardId);
      const siblings = (await tx.column.findMany({ where: { boardId: current.boardId, id: { not: columnId } } })).sort(byPosition);
      const p = positionAfter(siblings, data.afterColumnId);
      if (p === undefined) throw notFound();
      position = p;
    }
    const column = await tx.column.update({ where: { id: columnId }, data: { name: data.name, position } });
    const renamed = data.name !== undefined && data.name !== current.name;
    const activity = renamed
      ? await logActivity(tx, current.boardId, actor, "column.renamed", { from: current.name, to: column.name })
      : null;
    return { column, activity };
  });
  publish(column.boardId, { type: "column:updated", payload: columnDto(column), clientMutationId });
  if (activity) publishActivity(column.boardId, activity);
  return columnDto(column);
}

export async function deleteColumn(actor: Actor, columnId: string, clientMutationId?: string) {
  const { column, activity } = await prisma.$transaction(async (tx) => {
    const column = await columnInBoard(tx, columnId, actor.id);
    const cards = await tx.card.count({ where: { columnId } });
    await tx.column.delete({ where: { id: columnId } }); // cards cascade
    return { column, activity: await logActivity(tx, column.boardId, actor, "column.deleted", { name: column.name, cards }) };
  });
  publish(column.boardId, { type: "column:deleted", payload: { id: columnId }, clientMutationId });
  publishActivity(column.boardId, activity);
}
