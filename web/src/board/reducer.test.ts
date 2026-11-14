import { describe, expect, it } from "vitest";
import type { BoardState, CardDto } from "../api/types";
import { boardReducer, dropTarget, initialClientState, type ClientBoardState } from "./reducer";

const card = (id: string, columnId: string, position: string, version = 0): CardDto => ({
  id,
  columnId,
  title: id.toUpperCase(),
  description: "",
  assigneeId: null,
  dueDate: null,
  labels: [],
  position,
  version,
  updatedAt: "2026-11-14T00:00:00.000Z",
});

function base(): ClientBoardState {
  const state: BoardState = {
    board: { id: "b", name: "Quadro", ownerId: "u1", inviteToken: null, isGuestDemo: false, botPaused: false },
    members: [{ id: "u1", name: "Ana", isBot: false }],
    columns: [
      { id: "c1", name: "A fazer", position: "a0", cards: [card("x", "c1", "a0"), card("y", "c1", "a1"), card("z", "c1", "a2")] },
      { id: "c2", name: "Feito", position: "a1", cards: [card("w", "c2", "a0")] },
    ],
    activity: [],
  };
  return initialClientState(state);
}

const ids = (s: ClientBoardState, col: number) => s.columns[col].cards.map((c) => c.id);

describe("boardReducer", () => {
  it("card:moved from another user reorders", () => {
    const s = boardReducer(base(), { type: "card:moved", payload: card("z", "c2", "b0", 1) });
    expect(ids(s, 0)).toEqual(["x", "y"]);
    expect(ids(s, 1)).toEqual(["w", "z"]);
  });

  it("optimistic move shows the new order immediately and records the pending mutation", () => {
    const s = boardReducer(base(), { type: "optimistic:move", cardId: "z", columnId: "c1", afterCardId: "x", mutationId: "m1" });
    expect(ids(s, 0)).toEqual(["x", "z", "y"]);
    expect(s.pending).toEqual({ m1: "z" });
  });

  it("optimistic move then own echo leaves a single card at the server position and clears pending", () => {
    let s = boardReducer(base(), { type: "optimistic:move", cardId: "x", columnId: "c2", afterCardId: null, mutationId: "m1" });
    s = boardReducer(s, { type: "card:moved", payload: { ...card("x", "c2", "b0", 1), clientMutationId: "m1" } });
    expect(ids(s, 1)).toEqual(["w", "x"]); // server put it after w: server wins over the optimistic top position
    expect(s.columns.flatMap((c) => c.cards).filter((c) => c.id === "x")).toHaveLength(1);
    expect(s.columns[1].cards[1].position).toBe("b0");
    expect(s.pending).toEqual({});
  });

  it("ignores an event older than the card it already has", () => {
    let s = boardReducer(base(), { type: "card:moved", payload: card("x", "c2", "b0", 2) });
    s = boardReducer(s, { type: "card:moved", payload: card("x", "c1", "a0", 1) });
    expect(ids(s, 1)).toEqual(["w", "x"]);
  });

  it("card:deleted of a card being moved optimistically removes it and clears pending", () => {
    let s = boardReducer(base(), { type: "optimistic:move", cardId: "y", columnId: "c2", afterCardId: "w", mutationId: "m1" });
    s = boardReducer(s, { type: "card:deleted", payload: { id: "y", columnId: "c1" } });
    expect(s.columns.flatMap((c) => c.cards).map((c) => c.id)).not.toContain("y");
    expect(s.pending).toEqual({});
  });

  it("card:created inserts once even if the event repeats", () => {
    let s = boardReducer(base(), { type: "card:created", payload: card("n", "c2", "a5") });
    s = boardReducer(s, { type: "card:created", payload: card("n", "c2", "a5") });
    expect(ids(s, 1)).toEqual(["w", "n"]);
  });

  it("column:deleted removes the column and its cards", () => {
    const s = boardReducer(base(), { type: "column:deleted", payload: { id: "c1" } });
    expect(s.columns.map((c) => c.id)).toEqual(["c2"]);
  });

  it("column events and board updates apply", () => {
    let s = boardReducer(base(), { type: "column:created", payload: { id: "c0", name: "Backlog", position: "Z", cards: [] } });
    expect(s.columns.map((c) => c.id)).toEqual(["c0", "c1", "c2"]);
    s = boardReducer(s, { type: "column:updated", payload: { id: "c0", name: "Ideias", position: "b0" } });
    expect(s.columns.map((c) => c.name)).toEqual(["A fazer", "Feito", "Ideias"]);
    s = boardReducer(s, { type: "board:updated", payload: { botPaused: true } });
    expect(s.board.botPaused).toBe(true);
  });

  it("activity:new prepends without duplicates; members join and leave", () => {
    const a = { id: "a1", actorName: "Ana", type: "card.created", payload: {}, createdAt: "2026-11-14T00:00:00.000Z" };
    let s = boardReducer(base(), { type: "activity:new", payload: a });
    s = boardReducer(s, { type: "activity:new", payload: a });
    expect(s.activity).toHaveLength(1);
    s = boardReducer(s, { type: "member:joined", payload: { id: "u2", name: "Bob", isBot: false } });
    s = boardReducer(s, { type: "member:joined", payload: { id: "u2", name: "Bob", isBot: false } });
    expect(s.members.map((m) => m.id)).toEqual(["u1", "u2"]);
    s = boardReducer(s, { type: "member:left", payload: { userId: "u2" } });
    expect(s.members.map((m) => m.id)).toEqual(["u1"]);
  });

  it("reset replaces everything, pending included", () => {
    let s = boardReducer(base(), { type: "optimistic:move", cardId: "x", columnId: "c2", afterCardId: null, mutationId: "m1" });
    const fresh = { ...base(), columns: [] };
    s = boardReducer(s, { type: "reset", state: fresh });
    expect(s.columns).toEqual([]);
    expect(s.pending).toEqual({});
  });
});

describe("dropTarget", () => {
  const s = () => base();
  it("same column, moving down: lands after the hovered card", () => {
    expect(dropTarget(s(), "x", "z")).toEqual({ cardId: "x", columnId: "c1", afterCardId: "z" });
    expect(dropTarget(s(), "x", "y")).toEqual({ cardId: "x", columnId: "c1", afterCardId: "y" });
  });
  it("same column, moving up: takes the hovered card's place", () => {
    expect(dropTarget(s(), "z", "x")).toEqual({ cardId: "z", columnId: "c1", afterCardId: null });
    expect(dropTarget(s(), "z", "y")).toEqual({ cardId: "z", columnId: "c1", afterCardId: "x" });
  });
  it("another column: takes the hovered card's place", () => {
    expect(dropTarget(s(), "w", "y")).toEqual({ cardId: "w", columnId: "c1", afterCardId: "x" });
  });
  it("dropping on a column appends at the bottom", () => {
    expect(dropTarget(s(), "x", "c2")).toEqual({ cardId: "x", columnId: "c2", afterCardId: "w" });
  });
});
