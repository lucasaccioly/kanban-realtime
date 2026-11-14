import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";

export const app = createApp();

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function registerUser(name = "Ana") {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name, email: `${name.toLowerCase()}-${randomUUID()}@test.dev`, password: "senha12345" });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { token: string; user: { id: string; name: string; email: string; isGuest: boolean } };
}

export async function guestUser() {
  const res = await request(app).post("/api/auth/guest");
  if (res.status !== 201) throw new Error(`guest failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { token: string; user: { id: string; name: string; email: null; isGuest: boolean }; boardId: string };
}
