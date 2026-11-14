import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { recordedEvents } from "../src/realtime/bus.js";
import { app, auth, registerUser } from "./helpers.js";

async function createBoard(token: string, name = "Sprint") {
  const res = await request(app).post("/api/boards").set(auth(token)).send({ name });
  expect(res.status).toBe(201);
  return res.body;
}

async function inviteAndJoin(ownerToken: string, boardId: string, joinerToken: string) {
  const inv = await request(app).post(`/api/boards/${boardId}/invite`).set(auth(ownerToken));
  expect(inv.status).toBe(200);
  const join = await request(app).post(`/api/invites/${inv.body.inviteToken}/join`).set(auth(joinerToken));
  expect(join.status).toBe(200);
  expect(join.body).toEqual({ boardId });
  return inv.body.inviteToken as string;
}

describe("boards", () => {
  it("create returns the board state with the 3 default columns in order", async () => {
    const ana = await registerUser("Ana");
    const state = await createBoard(ana.token);
    expect(state.board).toMatchObject({ name: "Sprint", ownerId: ana.user.id, isGuestDemo: false, inviteToken: null });
    expect(state.columns.map((c: { name: string }) => c.name)).toEqual(["A fazer", "Fazendo", "Feito"]);
    expect(state.members).toEqual([{ id: ana.user.id, name: "Ana", isBot: false }]);
    const list = await request(app).get("/api/boards").set(auth(ana.token));
    expect(list.body.boards).toEqual([{ id: state.board.id, name: "Sprint", isOwner: true, memberCount: 1 }]);
  });

  it("non-member gets 404 on GET, PATCH and DELETE", async () => {
    const ana = await registerUser("Ana");
    const bob = await registerUser("Bob");
    const { board } = await createBoard(ana.token);
    expect((await request(app).get(`/api/boards/${board.id}`).set(auth(bob.token))).status).toBe(404);
    expect((await request(app).patch(`/api/boards/${board.id}`).set(auth(bob.token)).send({ name: "x" })).status).toBe(404);
    expect((await request(app).delete(`/api/boards/${board.id}`).set(auth(bob.token))).status).toBe(404);
    expect((await request(app).get(`/api/boards/not-a-uuid`).set(auth(bob.token))).status).toBe(404);
  });

  it("member who is not the owner gets 403 on owner actions", async () => {
    const ana = await registerUser("Ana");
    const bob = await registerUser("Bob");
    const { board } = await createBoard(ana.token);
    await inviteAndJoin(ana.token, board.id, bob.token);
    const res = await request(app).patch(`/api/boards/${board.id}`).set(auth(bob.token)).send({ name: "x" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Apenas o dono pode fazer isso");
    expect((await request(app).post(`/api/boards/${board.id}/invite`).set(auth(bob.token))).status).toBe(403);
  });

  it("owner renames the board and the event is published", async () => {
    const ana = await registerUser("Ana");
    const { board } = await createBoard(ana.token);
    const res = await request(app).patch(`/api/boards/${board.id}`).set(auth(ana.token)).send({ name: "Novo" });
    expect(res.status).toBe(200);
    expect(res.body.board.name).toBe("Novo");
    expect(recordedEvents().some((e) => e.boardId === board.id && e.event.type === "board:updated")).toBe(true);
  });

  it("join by invite adds the member once, lists the board and records member:joined", async () => {
    const ana = await registerUser("Ana");
    const bob = await registerUser("Bob");
    const { board } = await createBoard(ana.token);
    const token = await inviteAndJoin(ana.token, board.id, bob.token);
    const again = await request(app).post(`/api/invites/${token}/join`).set(auth(bob.token));
    expect(again.status).toBe(200);
    expect(await prisma.boardMember.count({ where: { boardId: board.id } })).toBe(2);
    expect(recordedEvents().filter((e) => e.event.type === "member:joined")).toHaveLength(1);
    const list = await request(app).get("/api/boards").set(auth(bob.token));
    expect(list.body.boards).toEqual([{ id: board.id, name: "Sprint", isOwner: false, memberCount: 2 }]);
    const state = await request(app).get(`/api/boards/${board.id}`).set(auth(bob.token));
    expect(state.status).toBe(200);
    expect(state.body.activity[0]).toMatchObject({ actorName: "Bob", type: "member.joined" });
  });

  it("revoked or unknown invite token is 404", async () => {
    const ana = await registerUser("Ana");
    const bob = await registerUser("Bob");
    const { board } = await createBoard(ana.token);
    const inv = await request(app).post(`/api/boards/${board.id}/invite`).set(auth(ana.token));
    expect((await request(app).delete(`/api/boards/${board.id}/invite`).set(auth(ana.token))).status).toBe(204);
    expect((await request(app).post(`/api/invites/${inv.body.inviteToken}/join`).set(auth(bob.token))).status).toBe(404);
    expect((await request(app).post(`/api/invites/nope/join`).set(auth(bob.token))).status).toBe(404);
  });

  it("member can leave; owner cannot", async () => {
    const ana = await registerUser("Ana");
    const bob = await registerUser("Bob");
    const { board } = await createBoard(ana.token);
    await inviteAndJoin(ana.token, board.id, bob.token);
    expect((await request(app).post(`/api/boards/${board.id}/leave`).set(auth(bob.token))).status).toBe(204);
    expect((await request(app).get(`/api/boards/${board.id}`).set(auth(bob.token))).status).toBe(404);
    const owner = await request(app).post(`/api/boards/${board.id}/leave`).set(auth(ana.token));
    expect(owner.status).toBe(409);
    expect(owner.body.error).toBe("O dono não pode sair do quadro");
  });

  it("owner removes a member, who then gets 404", async () => {
    const ana = await registerUser("Ana");
    const bob = await registerUser("Bob");
    const { board } = await createBoard(ana.token);
    await inviteAndJoin(ana.token, board.id, bob.token);
    const res = await request(app).delete(`/api/boards/${board.id}/members/${bob.user.id}`).set(auth(ana.token));
    expect(res.status).toBe(204);
    expect((await request(app).get(`/api/boards/${board.id}`).set(auth(bob.token))).status).toBe(404);
    expect(recordedEvents().some((e) => e.event.type === "member:left")).toBe(true);
  });

  it("owner deletes the board and board:deleted is published", async () => {
    const ana = await registerUser("Ana");
    const { board } = await createBoard(ana.token);
    expect((await request(app).delete(`/api/boards/${board.id}`).set(auth(ana.token))).status).toBe(204);
    expect(await prisma.board.count()).toBe(0);
    expect(recordedEvents().some((e) => e.boardId === board.id && e.event.type === "board:deleted")).toBe(true);
  });
});
