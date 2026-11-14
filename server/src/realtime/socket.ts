import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { verifyToken } from "../auth/token.js";
import { requireMember } from "../boards/access.js";
import { getBoardState } from "../boards/service.js";
import { HttpError } from "../errors.js";
import { onMembershipRevoked, setPublisher } from "./bus.js";
import { addSocket, boardsOfSocket, removeSocket, setFocus, snapshot } from "./presence.js";

const room = (boardId: string) => `board:${boardId}`;
const userRoom = (userId: string) => `user:${userId}`;

export function attachRealtime(httpServer: HttpServer): Server {
  const io = new Server(httpServer, { cors: { origin: process.env.WEB_ORIGIN ?? "http://localhost:5174" } });
  const broadcastPresence = (boardId: string) => io.to(room(boardId)).emit("presence:update", snapshot(boardId));

  io.use((socket, next) => {
    try {
      socket.data.userId = verifyToken(String(socket.handshake.auth?.token ?? ""));
      next();
    } catch {
      next(new Error("Não autenticado"));
    }
  });

  const leaveBoard = (socket: Socket, boardId: string) => {
    socket.leave(room(boardId));
    if (removeSocket(boardId, socket.id)) broadcastPresence(boardId);
  };

  io.on("connection", (socket) => {
    const userId: string = socket.data.userId;
    socket.join(userRoom(userId));

    socket.on("board:join", async (msg: { boardId?: unknown }, ack?: (r: unknown) => void) => {
      const boardId = typeof msg?.boardId === "string" ? msg.boardId : "";
      try {
        await requireMember(boardId, userId);
        socket.join(room(boardId));
        addSocket(boardId, socket.id, userId);
        // Re-check once in the room: a removal that landed between the first check and the join would
        // otherwise have found no socket to revoke. Any later removal finds this socket in the room.
        await requireMember(boardId, userId);
        const state = await getBoardState(boardId);
        broadcastPresence(boardId); // before the ack, so the joiner sees itself online first
        ack?.({ ok: true, state });
      } catch (e) {
        leaveBoard(socket, boardId);
        const notFound = e instanceof HttpError && e.status === 404;
        if (!notFound) console.error("board:join failed", e);
        ack?.({ ok: false, error: notFound ? "Não encontrado" : "Erro interno" });
      }
    });

    socket.on("board:leave", (msg: { boardId?: unknown }) => {
      if (typeof msg?.boardId === "string") leaveBoard(socket, msg.boardId);
    });

    socket.on("card:focus", (msg: { boardId?: unknown; cardId?: unknown }) => {
      if (typeof msg?.boardId !== "string") return;
      const cardId = typeof msg.cardId === "string" ? msg.cardId : null;
      if (setFocus(msg.boardId, socket.id, cardId)) broadcastPresence(msg.boardId);
    });

    socket.on("disconnect", () => {
      for (const boardId of boardsOfSocket(socket.id)) leaveBoard(socket, boardId);
    });
  });

  setPublisher((boardId, event) => {
    io.to(room(boardId)).emit(event.type, { ...(event.payload as object), clientMutationId: event.clientMutationId });
  });

  // Synchronous on purpose: the socket must be out of the room before the next event is published.
  onMembershipRevoked((boardId, userId) => {
    for (const socketId of io.sockets.adapter.rooms.get(userRoom(userId)) ?? []) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket?.rooms.has(room(boardId))) continue;
      leaveBoard(socket, boardId);
      socket.emit("board:removed", { boardId });
    }
  });

  return io;
}
