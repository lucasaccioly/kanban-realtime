import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSummaryPrompt } from "../src/ai/summary.js";
import { getBoardState } from "../src/boards/service.js";
import { prisma } from "../src/db.js";
import { app, auth, guestUser, registerUser } from "./helpers.js";

const UNAVAILABLE = "Resumo indisponível agora (limite diário atingido), tente amanhã";
const FAILED = "Resumo indisponível agora, tente de novo em alguns minutos";

function stubGroq(status = 200, content = "Resumo do quadro") {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const summarize = (token: string, boardId: string) => request(app).post(`/api/boards/${boardId}/summary`).set(auth(token));
const usage = () => prisma.aiUsage.findMany({ orderBy: { scope: "asc" } });

describe("AI summary", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
    delete process.env.AI_GLOBAL_DAILY;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GROQ_API_KEY;
    delete process.env.AI_GLOBAL_DAILY;
  });

  it("returns the summary and sends the key only to Groq", async () => {
    const fetchMock = stubGroq();
    const g = await guestUser();
    const res = await summarize(g.token, g.boardId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ summary: "Resumo do quadro" });
    expect(JSON.stringify(res.body)).not.toContain("test-key");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key");
    // gpt-oss is a reasoning model: reasoning tokens count against the cap, so keep effort low and hide the trace
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "openai/gpt-oss-20b",
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: 1024,
    });
  });

  it("strips markdown bold and headings, since the panel shows plain text", async () => {
    stubGroq(200, "## Progresso\n**Riscos**: nenhum\n- item");
    const g = await guestUser();
    const res = await summarize(g.token, g.boardId);
    expect(res.body).toEqual({ summary: "Progresso\nRiscos: nenhum\n- item" });
  });

  it("6th summary of the same user on the same day is 429", async () => {
    stubGroq();
    const g = await guestUser();
    for (let i = 0; i < 5; i++) expect((await summarize(g.token, g.boardId)).status).toBe(200);
    const res = await summarize(g.token, g.boardId);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe(UNAVAILABLE);
  });

  it("global daily limit applies across users", async () => {
    stubGroq();
    process.env.AI_GLOBAL_DAILY = "2";
    const a = await guestUser();
    const b = await guestUser();
    expect((await summarize(a.token, a.boardId)).status).toBe(200);
    expect((await summarize(a.token, a.boardId)).status).toBe(200);
    const res = await summarize(b.token, b.boardId);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe(UNAVAILABLE);
    expect((await usage()).find((u) => u.scope === b.user.id)?.count ?? 0).toBe(0);
  });

  it("Groq failure is 503 and the quota is refunded", async () => {
    stubGroq(500);
    const g = await guestUser();
    const res = await summarize(g.token, g.boardId);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe(FAILED);
    expect((await usage()).every((u) => u.count === 0)).toBe(true);
  });

  it("missing key is 503", async () => {
    const fetchMock = stubGroq();
    delete process.env.GROQ_API_KEY;
    const g = await guestUser();
    const res = await summarize(g.token, g.boardId);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe(FAILED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("non-member is 404", async () => {
    stubGroq();
    const g = await guestUser();
    const eve = await registerUser("Eve");
    expect((await summarize(eve.token, g.boardId)).status).toBe(404);
  });

  it("prompt lists overdue cards and cards parados for 3+ days", async () => {
    const g = await guestUser();
    const now = new Date();
    const card = await prisma.card.findFirstOrThrow({ where: { title: "Escrever testes do carrinho" } });
    await prisma.$executeRaw`UPDATE "Card" SET "updatedAt" = ${new Date(now.getTime() - 4 * 86400000)} WHERE id = ${card.id}`;
    const prompt = buildSummaryPrompt(await getBoardState(g.boardId), now);
    expect(prompt).toContain("Corrigir cálculo do frete"); // overdue in the seed
    expect(prompt).toMatch(/parado/i);
    expect(prompt).toContain("Escrever testes do carrinho");
    expect(prompt).toContain("A fazer: 4");
  });
});
