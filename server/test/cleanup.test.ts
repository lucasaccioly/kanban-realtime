import request from "supertest";
import { describe, expect, it } from "vitest";
import { getBoardState } from "../src/boards/service.js";
import { prisma } from "../src/db.js";
import { cleanupGuests } from "../src/jobs/cleanupGuests.js";
import { recordedEvents } from "../src/realtime/bus.js";
import { app, auth, guestUser, registerUser } from "./helpers.js";

const HOUR = 60 * 60 * 1000;

async function join(ownerToken: string, boardId: string, joinerToken: string) {
  const inv = await request(app).post(`/api/boards/${boardId}/invite`).set(auth(ownerToken));
  await request(app).post(`/api/invites/${inv.body.inviteToken}/join`).set(auth(joinerToken));
}

describe("cleanupGuests", () => {
  it("removes expired guests with cascades, keeping other boards' history readable", async () => {
    const now = new Date();
    const r = await registerUser("Rita");
    const g = await guestUser();
    const fresh = await guestUser();

    // G owns its demo board, where R is a member.
    await join(g.token, g.boardId, r.token);
    // R owns a board where G is a member; G is assignee of a card there and moves it.
    const rb = await request(app).post("/api/boards").set(auth(r.token)).send({ name: "Do R" });
    const cols = rb.body.columns.map((c: { id: string }) => c.id);
    await join(r.token, rb.body.board.id, g.token);
    const card = await request(app).post(`/api/columns/${cols[0]}/cards`).set(auth(r.token)).send({ title: "Tarefa", assigneeId: g.user.id });
    await request(app).post(`/api/cards/${card.body.id}/move`).set(auth(g.token)).send({ columnId: cols[1], afterCardId: null, version: 0 });

    await prisma.user.update({ where: { id: g.user.id }, data: { createdAt: new Date(now.getTime() - 25 * HOUR) } });
    await prisma.user.update({ where: { id: fresh.user.id }, data: { createdAt: new Date(now.getTime() - 23 * HOUR) } });

    expect(await cleanupGuests(now)).toBe(1);

    const list = await request(app).get("/api/boards").set(auth(r.token));
    expect(list.body.boards.map((b: { id: string }) => b.id)).toEqual([rb.body.board.id]);
    expect(await prisma.board.findUnique({ where: { id: g.boardId } })).toBeNull();
    expect(recordedEvents().some((e) => e.boardId === g.boardId && e.event.type === "board:deleted")).toBe(true);

    const state = await getBoardState(rb.body.board.id);
    expect(state.activity.find((a) => a.type === "card.moved")).toMatchObject({ actorName: "Visitante" });
    expect(state.columns[1].cards[0]).toMatchObject({ id: card.body.id, assigneeId: null });
    expect(state.members.map((m) => m.id)).toEqual([r.user.id]);

    expect(await prisma.user.findUnique({ where: { id: fresh.user.id } })).not.toBeNull();
  });
});
