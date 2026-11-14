import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { botTick } from "../src/bot/teammate.js";
import { resetPresence } from "../src/realtime/presence.js";
import { app, auth, guestUser, registerUser } from "./helpers.js";
import { closeAll, connect, joinBoard, nextEvent, recordAll, startTestServer } from "./socketHelpers.js";

let server: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());
afterEach(() => {
  closeAll();
  resetPresence();
});

const CARD_EVENTS = ["card:created", "card:moved", "card:updated"];

describe("virtual teammate", () => {
  it("acts once on a demo board with a human online, as Bia (bot)", async () => {
    const g = await guestUser();
    const s = await connect(server.url, g.token);
    await joinBoard(s, g.boardId);
    const events = recordAll(s);
    const activity = nextEvent(s, "activity:new");
    expect(await botTick(new Date())).toBe(1);
    expect(await activity).toMatchObject({ actorName: "Bia (bot)" });
    expect(events.some((e) => CARD_EVENTS.includes(e.name))).toBe(true);
  });

  it("does nothing when nobody is online", async () => {
    await guestUser();
    expect(await botTick(new Date())).toBe(0);
  });

  it("does nothing when paused, and resumes when unpaused", async () => {
    const g = await guestUser();
    const s = await connect(server.url, g.token);
    await joinBoard(s, g.boardId);
    const updated = nextEvent(s, "board:updated");
    const res = await request(app).patch(`/api/boards/${g.boardId}/bot`).set(auth(g.token)).send({ paused: true });
    expect(res.status).toBe(200);
    expect(await updated).toMatchObject({ botPaused: true });
    expect(await botTick(new Date())).toBe(0);
    await request(app).patch(`/api/boards/${g.boardId}/bot`).set(auth(g.token)).send({ paused: false });
    expect(await botTick(new Date())).toBe(1);
  });

  it("ignores regular boards with members online, whose bot route is 404", async () => {
    const ana = await registerUser("Ana");
    const created = await request(app).post("/api/boards").set(auth(ana.token)).send({ name: "Sprint" });
    const s = await connect(server.url, ana.token);
    await joinBoard(s, created.body.board.id);
    expect(await botTick(new Date())).toBe(0);
    const res = await request(app).patch(`/api/boards/${created.body.board.id}/bot`).set(auth(ana.token)).send({ paused: true });
    expect(res.status).toBe(404);
  });
});
