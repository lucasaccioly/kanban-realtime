// shortcut: in-process presence, correct for a single server instance; needs Redis (or the Socket.io adapter) to scale out.
type Entry = { userId: string; editing: string | null };
const boards = new Map<string, Map<string, Entry>>(); // boardId -> socketId -> entry

export type PresenceSnapshot = { boardId: string; online: string[]; editing: Record<string, string> };

export function addSocket(boardId: string, socketId: string, userId: string) {
  let sockets = boards.get(boardId);
  if (!sockets) boards.set(boardId, (sockets = new Map()));
  if (!sockets.has(socketId)) sockets.set(socketId, { userId, editing: null });
}

/** Returns true when the socket was present on that board. */
export function removeSocket(boardId: string, socketId: string): boolean {
  const sockets = boards.get(boardId);
  const had = sockets?.delete(socketId) ?? false;
  if (sockets?.size === 0) boards.delete(boardId);
  return had;
}

export function setFocus(boardId: string, socketId: string, cardId: string | null): boolean {
  const entry = boards.get(boardId)?.get(socketId);
  if (!entry) return false;
  entry.editing = cardId;
  return true;
}

export const boardsOfSocket = (socketId: string) => [...boards].filter(([, s]) => s.has(socketId)).map(([id]) => id);

export function snapshot(boardId: string): PresenceSnapshot {
  const entries = [...(boards.get(boardId)?.values() ?? [])];
  const editing: Record<string, string> = {};
  for (const e of entries) if (e.editing) editing[e.editing] = e.userId;
  return { boardId, online: [...new Set(entries.map((e) => e.userId))], editing };
}

export const onlineHumans = (boardId: string) => snapshot(boardId).online;
export const boardsWithHumansOnline = () => [...boards.keys()];
export const resetPresence = () => boards.clear();
