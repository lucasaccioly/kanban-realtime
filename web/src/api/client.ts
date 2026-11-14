export const TOKEN_KEY = "fb_token";
export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3002").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/** fetch wrapper for the API: Bearer token, JSON, client mutation id; throws ApiError with the server's message. */
export async function apiFetch<T>(path: string, init: RequestInit & { mutationId?: string } = {}): Promise<T> {
  const { mutationId, ...rest } = init;
  const headers = new Headers(rest.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (rest.body !== undefined) headers.set("Content-Type", "application/json");
  if (mutationId) headers.set("X-Client-Mutation-Id", mutationId);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...rest, headers });
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("fb:unauthorized"));
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Erro inesperado");
  return data as T;
}

/** JSON body helper: `post("/api/x", {a: 1})`. */
export const send = <T>(method: string, path: string, body?: unknown, mutationId?: string) =>
  apiFetch<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body), mutationId });
