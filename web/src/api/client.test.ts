import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, TOKEN_KEY } from "./client";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("apiFetch", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("adds the Bearer header when a token is stored", async () => {
    localStorage.setItem(TOKEN_KEY, "abc");
    const fetchMock = stubFetch(200, { ok: true });
    expect(await apiFetch("/api/health")).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3002/api/health");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer abc");
  });

  it("sends the client mutation id and a JSON body", async () => {
    const fetchMock = stubFetch(201, { id: "1" });
    await apiFetch("/api/cards/1/move", { method: "POST", body: JSON.stringify({ a: 1 }), mutationId: "m-7" });
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("X-Client-Mutation-Id")).toBe("m-7");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("maps the server error to ApiError", async () => {
    stubFetch(409, { error: "E-mail já cadastrado" });
    const err = await apiFetch("/api/auth/register", { method: "POST" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: "E-mail já cadastrado" });
  });

  it("a 401 clears the stored token", async () => {
    localStorage.setItem(TOKEN_KEY, "expired");
    stubFetch(401, { error: "Não autenticado" });
    await expect(apiFetch("/api/auth/me")).rejects.toMatchObject({ status: 401 });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("204 resolves to undefined", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    expect(await apiFetch("/api/cards/1", { method: "DELETE" })).toBeUndefined();
  });
});
