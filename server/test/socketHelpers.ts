import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket } from "socket.io-client";
import { createApp } from "../src/app.js";
import { attachRealtime } from "../src/realtime/socket.js";

export async function startTestServer() {
  const server = createServer(createApp());
  const io = attachRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;
  return {
    url,
    close: () => new Promise<void>((resolve) => io.close(() => resolve())),
  };
}

const open: Socket[] = [];

export function connect(url: string, token: string): Promise<Socket> {
  const socket = ioClient(url, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
  open.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

export const closeAll = () => {
  for (const s of open.splice(0)) s.disconnect();
};

export function joinBoard(socket: Socket, boardId: string): Promise<{ ok: boolean; state?: any; error?: string }> {
  return socket.timeout(2000).emitWithAck("board:join", { boardId });
}

export function nextEvent<T = any>(socket: Socket, name: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, handler);
      reject(new Error(`timeout waiting for ${name}`));
    }, timeoutMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(name, handler);
  });
}

/** Records every event a socket receives, for asserting what did NOT arrive. */
export function recordAll(socket: Socket) {
  const events: { name: string; payload: any }[] = [];
  socket.onAny((name, payload) => events.push({ name, payload }));
  return events;
}

/** Resolves once `predicate` holds, polling every 20 ms. */
export async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}
