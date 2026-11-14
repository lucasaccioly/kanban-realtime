import { randomBytes } from "node:crypto";
import { Router } from "express";
import { generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";
import { createColumn } from "../columns/service.js";
import { prisma } from "../db.js";
import { clientMutationId } from "../lib/position.js";
import { HttpError, notFound } from "../errors.js";
import { publish, revokeMembership } from "../realtime/bus.js";
import { DEFAULT_COLUMNS } from "../seed/guestBoard.js";
import { requireMember, requireOwner } from "./access.js";
import { getBoardState, logActivity, publishActivity, type Actor } from "./service.js";

const nameSchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function actorOf(userId: string): Promise<Actor> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(401, "Não autenticado");
  return { id: user.id, name: user.name };
}

export const boardsRouter = Router();

boardsRouter.get("/", async (req, res) => {
  const boards = await prisma.board.findMany({
    where: { members: { some: { userId: req.userId! } } },
    include: { _count: { select: { members: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({
    boards: boards.map((b) => ({ id: b.id, name: b.name, isOwner: b.ownerId === req.userId, memberCount: b._count.members })),
  });
});

boardsRouter.post("/", async (req, res) => {
  const { name } = nameSchema.parse(req.body);
  const actor = await actorOf(req.userId!);
  const keys = generateNKeysBetween(null, null, DEFAULT_COLUMNS.length);
  const state = await prisma.$transaction(async (tx) => {
    const board = await tx.board.create({
      data: {
        name,
        ownerId: actor.id,
        members: { create: { userId: actor.id } },
        columns: { create: DEFAULT_COLUMNS.map((n, i) => ({ name: n, position: keys[i] })) },
      },
    });
    await logActivity(tx, board.id, actor, "board.created", { name });
    return getBoardState(board.id, tx);
  });
  res.status(201).json(state);
});

boardsRouter.get("/:id", async (req, res) => {
  await requireMember(req.params.id, req.userId!);
  res.json(await getBoardState(req.params.id));
});

boardsRouter.post("/:id/columns", async (req, res) => {
  const actor = await actorOf(req.userId!);
  res.status(201).json(await createColumn(actor, req.params.id, req.body?.name, clientMutationId(req)));
});

boardsRouter.patch("/:id", async (req, res) => {
  const board = await requireOwner(req.params.id, req.userId!);
  const { name } = nameSchema.parse(req.body);
  const actor = await actorOf(req.userId!);
  const activity = await prisma.$transaction(async (tx) => {
    await tx.board.update({ where: { id: board.id }, data: { name } });
    return logActivity(tx, board.id, actor, "board.renamed", { from: board.name, to: name });
  });
  publish(board.id, { type: "board:updated", payload: { name } });
  publishActivity(board.id, activity);
  res.json(await getBoardState(board.id));
});

boardsRouter.delete("/:id", async (req, res) => {
  const board = await requireOwner(req.params.id, req.userId!);
  const members = await prisma.boardMember.findMany({ where: { boardId: board.id } });
  await prisma.board.delete({ where: { id: board.id } });
  publish(board.id, { type: "board:deleted", payload: { boardId: board.id } });
  for (const m of members) revokeMembership(board.id, m.userId);
  res.status(204).end();
});

boardsRouter.post("/:id/invite", async (req, res) => {
  const board = await requireOwner(req.params.id, req.userId!);
  const inviteToken = randomBytes(24).toString("base64url");
  await prisma.board.update({ where: { id: board.id }, data: { inviteToken } });
  res.json({ inviteToken });
});

boardsRouter.delete("/:id/invite", async (req, res) => {
  const board = await requireOwner(req.params.id, req.userId!);
  await prisma.board.update({ where: { id: board.id }, data: { inviteToken: null } });
  res.status(204).end();
});

async function removeMember(boardId: string, userId: string, actor: Actor, type: "member.left" | "member.removed", name: string) {
  const activity = await prisma.$transaction(async (tx) => {
    await tx.boardMember.delete({ where: { boardId_userId: { boardId, userId } } });
    return logActivity(tx, boardId, actor, type, { userId, name });
  });
  revokeMembership(boardId, userId);
  publish(boardId, { type: "member:left", payload: { userId } });
  publishActivity(boardId, activity);
}

boardsRouter.post("/:id/leave", async (req, res) => {
  const board = await requireMember(req.params.id, req.userId!);
  if (board.ownerId === req.userId) throw new HttpError(409, "O dono não pode sair do quadro");
  const actor = await actorOf(req.userId!);
  await removeMember(board.id, actor.id, actor, "member.left", actor.name);
  res.status(204).end();
});

boardsRouter.delete("/:id/members/:userId", async (req, res) => {
  const board = await requireOwner(req.params.id, req.userId!);
  if (req.params.userId === board.ownerId) throw new HttpError(409, "O dono não pode sair do quadro");
  const member = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: board.id, userId: req.params.userId } },
    include: { user: true },
  });
  if (!member) throw notFound();
  await removeMember(board.id, member.userId, await actorOf(req.userId!), "member.removed", member.user.name);
  res.status(204).end();
});

export const invitesRouter = Router();

invitesRouter.post("/:token/join", async (req, res) => {
  const board = await prisma.board.findUnique({ where: { inviteToken: req.params.token } });
  if (!board) throw notFound();
  const actor = await actorOf(req.userId!);
  const joined = await prisma.$transaction(async (tx) => {
    const existing = await tx.boardMember.findUnique({ where: { boardId_userId: { boardId: board.id, userId: actor.id } } });
    if (existing) return null;
    const member = await tx.boardMember.create({ data: { boardId: board.id, userId: actor.id }, include: { user: true } });
    const activity = await logActivity(tx, board.id, actor, "member.joined", {});
    return { member, activity };
  });
  if (joined) {
    const { user } = joined.member;
    publish(board.id, { type: "member:joined", payload: { id: user.id, name: user.name, isBot: user.isBot } });
    publishActivity(board.id, joined.activity);
  }
  res.json({ boardId: board.id });
});
