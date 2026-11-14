import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getBoardState } from "../src/boards/service.js";
import { resetPresence } from "../src/realtime/presence.js";
import { app, auth, registerUser } from "./helpers.js";
import { closeAll, connect, joinBoard, nextEvent, recordAll, startTestServer, waitFor } from "./socketHelpers.js";

let server: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());
afterEach(() => {
  closeAll();
  resetPresence();
});

async function sharedBoard() {
  const ana = await registerUser("Ana");
  const bob = await registerUser("Bob");
  const created = await request(app).post("/api/boards").set(auth(ana.token)).send({ name: "Sprint" });
  const boardId: string = created.body.board.id;
  const cols: string[] = created.body.columns.map((c: { id: string }) => c.id);
  const inv = await request(app).post(`/api/boards/${boardId}/invite`).set(auth(ana.token));
  await request(app).post(`/api/invites/${inv.body.inviteToken}/join`).set(auth(bob.token));
  const card = await request(app).post(`/api/columns/${cols[0]}/cards`).set(auth(ana.token)).send({ title: "Login" });
  return { ana, bob, boardId, cols, card: card.body };
}

describe("realtime", () => {
  it("rejects a bad token at the handshake", async () => {
    await expect(connect(server.url, "nope")).rejects.toThrow("Não autenticado");
  });

  it("non-member cannot join the room", async () => {
    const { boardId } = await sharedBoard();
    const eve = await registerUser("Eve");
    const s = await connect(server.url, eve.token);
    expect(await joinBoard(s, boardId)).toEqual({ ok: false, error: "Não encontrado" });
  });

  it("join returns the board state", async () => {
    const { ana, boardId } = await sharedBoard();
    const s = await connect(server.url, ana.token);
    const ack = await joinBoard(s, boardId);
    expect(ack.ok).toBe(true);
    expect(ack.state.board.id).toBe(boardId);
    expect(ack.state.columns[0].cards[0].title).toBe("Login");
  });

  it("a REST move by A reaches B with A's clientMutationId", async () => {
    const { ana, bob, boardId, cols, card } = await sharedBoard();
    const a = await connect(server.url, ana.token);
    const b = await connect(server.url, bob.token);
    await joinBoard(a, boardId);
    await joinBoard(b, boardId);
    const got = nextEvent(b, "card:moved");
    await request(app)
      .post(`/api/cards/${card.id}/move`)
      .set(auth(ana.token))
      .set("X-Client-Mutation-Id", "mut-42")
      .send({ columnId: cols[1], afterCardId: null, version: 0 });
    expect(await got).toMatchObject({ id: card.id, columnId: cols[1], version: 1, clientMutationId: "mut-42" });
  });

  it("presence lists both members, then one after a disconnect, and shows card focus", async () => {
    const { ana, bob, boardId, card } = await sharedBoard();
    const a = await connect(server.url, ana.token);
    const b = await connect(server.url, bob.token);
    await joinBoard(a, boardId);
    const both = nextEvent(a, "presence:update");
    await joinBoard(b, boardId);
    expect((await both).online.sort()).toEqual([ana.user.id, bob.user.id].sort());

    const focus = nextEvent(a, "presence:update");
    b.emit("card:focus", { boardId, cardId: card.id });
    expect(await focus).toMatchObject({ boardId, editing: { [card.id]: bob.user.id } });

    const after = nextEvent(a, "presence:update");
    b.disconnect();
    expect(await after).toEqual({ boardId, online: [ana.user.id], editing: {} });
  });

  it("a removed member gets board:removed and no later events", async () => {
    const { ana, bob, boardId, cols } = await sharedBoard();
    const a = await connect(server.url, ana.token);
    const b = await connect(server.url, bob.token);
    await joinBoard(a, boardId);
    await joinBoard(b, boardId);
    const bEvents = recordAll(b);
    const removed = nextEvent(b, "board:removed");
    await request(app).delete(`/api/boards/${boardId}/members/${bob.user.id}`).set(auth(ana.token));
    expect(await removed).toEqual({ boardId });

    const aGot = nextEvent(a, "card:created");
    await request(app).post(`/api/columns/${cols[0]}/cards`).set(auth(ana.token)).send({ title: "Segredo" });
    await aGot;
    await new Promise((r) => setTimeout(r, 100));
    expect(bEvents.map((e) => e.name)).not.toContain("card:created");
    expect(bEvents.map((e) => e.name)).not.toContain("activity:new");
  });

  it("deleting the board removes everyone from the room", async () => {
    const { ana, bob, boardId } = await sharedBoard();
    const b = await connect(server.url, bob.token);
    await joinBoard(b, boardId);
    const deleted = nextEvent(b, "board:deleted");
    const removed = nextEvent(b, "board:removed");
    await request(app).delete(`/api/boards/${boardId}`).set(auth(ana.token));
    expect(await deleted).toMatchObject({ boardId });
    expect(await removed).toEqual({ boardId });
  });

  it("two near-simultaneous moves of one card converge on both clients", async () => {
    const { ana, bob, boardId, cols, card } = await sharedBoard();
    const a = await connect(server.url, ana.token);
    const b = await connect(server.url, bob.token);
    await joinBoard(a, boardId);
    await joinBoard(b, boardId);
    const aMoves = recordAll(a);
    const bMoves = recordAll(b);
    const move = (token: string, columnId: string) =>
      request(app).post(`/api/cards/${card.id}/move`).set(auth(token)).send({ columnId, afterCardId: null, version: 0 });
    const results = await Promise.all([move(ana.token, cols[1]), move(bob.token, cols[2])]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);

    const moved = (ev: ReturnType<typeof recordAll>) => ev.filter((e) => e.name === "card:moved");
    await waitFor(() => moved(aMoves).length === 2 && moved(bMoves).length === 2);
    const db = (await getBoardState(boardId)).columns.flatMap((c) => c.cards).find((c) => c.id === card.id)!;
    for (const ev of [aMoves, bMoves]) {
      const last = moved(ev).at(-1)!.payload;
      expect(last).toMatchObject({ columnId: db.columnId, position: db.position, version: db.version });
    }
    expect(db.version).toBe(2);
  });

  it("rejoining after a reconnect returns fresh state", async () => {
    const { ana, boardId, cols } = await sharedBoard();
    const a = await connect(server.url, ana.token);
    await joinBoard(a, boardId);
    a.disconnect();
    await request(app).post(`/api/columns/${cols[2]}/cards`).set(auth(ana.token)).send({ title: "Enquanto offline" });
    const again = await connect(server.url, ana.token);
    const ack = await joinBoard(again, boardId);
    expect(ack.state.columns[2].cards.map((c: { title: string }) => c.title)).toEqual(["Enquanto offline"]);
  });
});
