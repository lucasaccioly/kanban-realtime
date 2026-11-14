import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { getBoardState } from "../src/boards/service.js";
import { prisma } from "../src/db.js";
import { recordedEvents } from "../src/realtime/bus.js";
import { app, auth, registerUser } from "./helpers.js";

type Ctx = { token: string; boardId: string; cols: string[] };

async function boardFor(name = "Ana"): Promise<Ctx> {
  const u = await registerUser(name);
  const res = await request(app).post("/api/boards").set(auth(u.token)).send({ name: "Sprint" });
  return { token: u.token, boardId: res.body.board.id, cols: res.body.columns.map((c: { id: string }) => c.id) };
}

async function addCard(ctx: Ctx, col: number, title: string, extra: object = {}) {
  const res = await request(app).post(`/api/columns/${ctx.cols[col]}/cards`).set(auth(ctx.token)).send({ title, ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

const titlesIn = async (boardId: string, col: number) =>
  (await getBoardState(boardId)).columns[col].cards.map((c) => c.title);

describe("cards and columns", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boardFor();
  });

  it("create card publishes card:created with the request's clientMutationId", async () => {
    const res = await request(app)
      .post(`/api/columns/${ctx.cols[0]}/cards`)
      .set(auth(ctx.token))
      .set("X-Client-Mutation-Id", "m-1")
      .send({ title: "Login", labels: ["feature"] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "Login", labels: ["feature"], version: 0, columnId: ctx.cols[0] });
    const ev = recordedEvents().find((e) => e.event.type === "card:created");
    expect(ev).toMatchObject({ boardId: ctx.boardId, event: { clientMutationId: "m-1", payload: { id: res.body.id } } });
    expect(recordedEvents().some((e) => e.event.type === "activity:new")).toBe(true);
  });

  it("new cards append at the bottom; move to the top of another column reorders", async () => {
    await addCard(ctx, 0, "A");
    const b = await addCard(ctx, 0, "B");
    await addCard(ctx, 1, "X");
    expect(await titlesIn(ctx.boardId, 0)).toEqual(["A", "B"]);
    const res = await request(app)
      .post(`/api/cards/${b.id}/move`)
      .set(auth(ctx.token))
      .send({ columnId: ctx.cols[1], afterCardId: null, version: b.version });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ columnId: ctx.cols[1], version: 1 });
    expect(await titlesIn(ctx.boardId, 0)).toEqual(["A"]);
    expect(await titlesIn(ctx.boardId, 1)).toEqual(["B", "X"]);
  });

  it("move after a card places it right below that card", async () => {
    const a = await addCard(ctx, 0, "A");
    await addCard(ctx, 0, "B");
    const c = await addCard(ctx, 0, "C");
    const res = await request(app)
      .post(`/api/cards/${c.id}/move`)
      .set(auth(ctx.token))
      .send({ columnId: ctx.cols[0], afterCardId: a.id, version: 0 });
    expect(res.status).toBe(200);
    expect(await titlesIn(ctx.boardId, 0)).toEqual(["A", "C", "B"]);
  });

  it("move with a stale version still applies and increments the version", async () => {
    const a = await addCard(ctx, 0, "A");
    await request(app).patch(`/api/cards/${a.id}`).set(auth(ctx.token)).send({ title: "A2" });
    const res = await request(app)
      .post(`/api/cards/${a.id}/move`)
      .set(auth(ctx.token))
      .send({ columnId: ctx.cols[2], afterCardId: null, version: 0 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "A2", columnId: ctx.cols[2], version: 2 });
  });

  it("move into another board's column is 404 and changes nothing", async () => {
    const a = await addCard(ctx, 0, "A");
    const other = await boardFor("Bob");
    const res = await request(app)
      .post(`/api/cards/${a.id}/move`)
      .set(auth(ctx.token))
      .send({ columnId: other.cols[0], afterCardId: null, version: 0 });
    expect(res.status).toBe(404);
    const card = await prisma.card.findUniqueOrThrow({ where: { id: a.id } });
    expect(card).toMatchObject({ columnId: ctx.cols[0], version: 0, position: a.position });
  });

  it("afterCardId from another column is 404", async () => {
    const a = await addCard(ctx, 0, "A");
    const x = await addCard(ctx, 1, "X");
    const res = await request(app)
      .post(`/api/cards/${a.id}/move`)
      .set(auth(ctx.token))
      .send({ columnId: ctx.cols[2], afterCardId: x.id, version: 0 });
    expect(res.status).toBe(404);
  });

  it("assignee who is not a member is 400; a member is accepted", async () => {
    const bob = await registerUser("Bob");
    const me = await request(app).get("/api/auth/me").set(auth(ctx.token));
    const res = await request(app)
      .post(`/api/columns/${ctx.cols[0]}/cards`)
      .set(auth(ctx.token))
      .send({ title: "A", assigneeId: bob.user.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Responsável não é membro do quadro");
    const ok = await addCard(ctx, 0, "B", { assigneeId: me.body.user.id, dueDate: "2026-12-01" });
    expect(ok.assigneeId).toBe(me.body.user.id);
    expect(ok.dueDate).toBe("2026-12-01T00:00:00.000Z");
  });

  it("invalid label or empty title is 400", async () => {
    const bad = await request(app).post(`/api/columns/${ctx.cols[0]}/cards`).set(auth(ctx.token)).send({ title: "A", labels: ["nope"] });
    expect(bad.status).toBe(400);
    const empty = await request(app).post(`/api/columns/${ctx.cols[0]}/cards`).set(auth(ctx.token)).send({ title: " " });
    expect(empty.status).toBe(400);
  });

  it("update card changes fields and bumps the version", async () => {
    const a = await addCard(ctx, 0, "A");
    const res = await request(app)
      .patch(`/api/cards/${a.id}`)
      .set(auth(ctx.token))
      .send({ description: "detalhes", labels: ["bug", "urgente"], dueDate: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "A", description: "detalhes", labels: ["bug", "urgente"], version: 1 });
    expect(recordedEvents().some((e) => e.event.type === "card:updated")).toBe(true);
  });

  it("delete card removes it and publishes card:deleted", async () => {
    const a = await addCard(ctx, 0, "A");
    expect((await request(app).delete(`/api/cards/${a.id}`).set(auth(ctx.token))).status).toBe(204);
    expect(await prisma.card.count()).toBe(0);
    expect(recordedEvents().find((e) => e.event.type === "card:deleted")?.event.payload).toEqual({ id: a.id, columnId: ctx.cols[0] });
  });

  it("delete column with 2 cards removes them and publishes column:deleted", async () => {
    await addCard(ctx, 1, "A");
    await addCard(ctx, 1, "B");
    expect((await request(app).delete(`/api/columns/${ctx.cols[1]}`).set(auth(ctx.token))).status).toBe(204);
    const state = await getBoardState(ctx.boardId);
    expect(state.columns.map((c) => c.name)).toEqual(["A fazer", "Feito"]);
    expect(await prisma.card.count()).toBe(0);
    expect(recordedEvents().find((e) => e.event.type === "column:deleted")?.event.payload).toEqual({ id: ctx.cols[1] });
  });

  it("create, rename and reorder columns", async () => {
    const created = await request(app).post(`/api/boards/${ctx.boardId}/columns`).set(auth(ctx.token)).send({ name: "Revisão" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Revisão", cards: [] });
    const renamed = await request(app).patch(`/api/columns/${created.body.id}`).set(auth(ctx.token)).send({ name: "Review" });
    expect(renamed.body.name).toBe("Review");
    const moved = await request(app).patch(`/api/columns/${created.body.id}`).set(auth(ctx.token)).send({ afterColumnId: null });
    expect(moved.status).toBe(200);
    expect((await getBoardState(ctx.boardId)).columns.map((c) => c.name)).toEqual(["Review", "A fazer", "Fazendo", "Feito"]);
    const bad = await request(app).patch(`/api/columns/${created.body.id}`).set(auth(ctx.token)).send({ afterColumnId: (await boardFor("Bob")).cols[0] });
    expect(bad.status).toBe(404);
  });

  it("activity feed shows card.moved with column names", async () => {
    const a = await addCard(ctx, 0, "Login");
    await request(app).post(`/api/cards/${a.id}/move`).set(auth(ctx.token)).send({ columnId: ctx.cols[2], afterCardId: null, version: 0 });
    const { activity } = await getBoardState(ctx.boardId);
    expect(activity[0]).toMatchObject({
      actorName: "Ana",
      type: "card.moved",
      payload: { cardId: a.id, title: "Login", fromColumn: "A fazer", toColumn: "Feito" },
    });
  });

  it("non-member mutations are 404", async () => {
    const a = await addCard(ctx, 0, "A");
    const bob = await registerUser("Bob");
    const h = auth(bob.token);
    expect((await request(app).post(`/api/columns/${ctx.cols[0]}/cards`).set(h).send({ title: "x" })).status).toBe(404);
    expect((await request(app).patch(`/api/cards/${a.id}`).set(h).send({ title: "x" })).status).toBe(404);
    expect((await request(app).delete(`/api/cards/${a.id}`).set(h)).status).toBe(404);
    expect((await request(app).post(`/api/cards/${a.id}/move`).set(h).send({ columnId: ctx.cols[1], afterCardId: null, version: 0 })).status).toBe(404);
    expect((await request(app).delete(`/api/columns/${ctx.cols[0]}`).set(h)).status).toBe(404);
    expect((await request(app).post(`/api/boards/${ctx.boardId}/columns`).set(h).send({ name: "x" })).status).toBe(404);
  });
});
