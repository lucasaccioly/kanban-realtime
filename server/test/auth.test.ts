import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { getBoardState } from "../src/boards/service.js";
import { prisma } from "../src/db.js";
import { BOT_EMAIL } from "../src/seed/guestBoard.js";
import { app, auth, guestUser, registerUser } from "./helpers.js";

const register = (body: object) => request(app).post("/api/auth/register").send(body);

describe("auth", () => {
  it("register returns a token and the lowercased email", async () => {
    const res = await register({ name: "Ana", email: "  Ana@Test.DEV ", password: "senha12345" });
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ name: "Ana", email: "ana@test.dev", isGuest: false });
    const me = await request(app).get("/api/auth/me").set(auth(res.body.token));
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(res.body.user.id);
  });

  it("duplicate email in another case is 409", async () => {
    await register({ name: "Ana", email: "ana@test.dev", password: "senha12345" });
    const res = await register({ name: "Ana 2", email: "ANA@test.dev", password: "senha12345" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("E-mail já cadastrado");
  });

  it("rejects invalid register data with 400", async () => {
    const res = await register({ name: "", email: "x", password: "123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Dados inválidos");
  });

  it("login with the right password works and the wrong one is 401", async () => {
    await register({ name: "Ana", email: "ana@test.dev", password: "senha12345" });
    const ok = await request(app).post("/api/auth/login").send({ email: "ANA@test.dev", password: "senha12345" });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe("ana@test.dev");
    const bad = await request(app).post("/api/auth/login").send({ email: "ana@test.dev", password: "errada123" });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("E-mail ou senha inválidos");
  });

  it("me without, with invalid and with expired token is 401", async () => {
    const { user } = await registerUser();
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set(auth("nope"))).status).toBe(401);
    const expired = jwt.sign({ exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET!, { subject: user.id });
    expect((await request(app).get("/api/auth/me").set(auth(expired))).status).toBe(401);
  });

  it("guest gets a demo board with 3 columns, 8+ cards and the bot as member", async () => {
    const { user, boardId } = await guestUser();
    expect(user).toMatchObject({ name: "Visitante", isGuest: true });
    const board = await prisma.board.findUniqueOrThrow({
      where: { id: boardId },
      include: { columns: { include: { cards: true } }, members: { include: { user: true } }, activities: true },
    });
    expect(board.isGuestDemo).toBe(true);
    expect(board.ownerId).toBe(user.id);
    expect(board.columns.map((c) => c.name).sort()).toEqual(["A fazer", "Fazendo", "Feito"]);
    expect(board.columns.flatMap((c) => c.cards).length).toBeGreaterThanOrEqual(8);
    expect(board.members.map((m) => m.user.email)).toContain(BOT_EMAIL);
    expect(board.activities.length).toBe(3);
  });

  it("seeded activity uses the feed's payload shape and a stable newest-first order", async () => {
    const { boardId } = await guestUser();
    const { activity } = await getBoardState(boardId);
    expect(activity.map((a) => a.type)).toEqual(["card.moved", "member.joined", "board.created"]);
    expect(activity[0].payload).toMatchObject({ title: "Configurar CI", toColumn: "Feito" });
  });

  it("6th guest from the same IP within an hour is 429", async () => {
    for (let i = 0; i < 5; i++) await guestUser();
    const res = await request(app).post("/api/auth/guest");
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Muitas tentativas, tente mais tarde");
  });

  it("behind a proxy (TRUST_PROXY=1) the login limit is per client IP", async () => {
    process.env.TRUST_PROXY = "1";
    const proxied = createApp();
    delete process.env.TRUST_PROXY;
    const login = (ip: string) =>
      request(proxied).post("/api/auth/login").set("X-Forwarded-For", ip).send({ email: "x@test.dev", password: "senha12345" });
    for (let i = 0; i < 10; i++) await login("1.1.1.1");
    expect((await login("1.1.1.1")).status).toBe(429);
    expect((await login("2.2.2.2")).status).toBe(401);
  });

  it("11th login within a minute is 429", async () => {
    for (let i = 0; i < 10; i++) {
      await request(app).post("/api/auth/login").send({ email: "x@test.dev", password: "senha12345" });
    }
    const res = await request(app).post("/api/auth/login").send({ email: "x@test.dev", password: "senha12345" });
    expect(res.status).toBe(429);
  });
});
