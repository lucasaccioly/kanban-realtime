// Decouples services (which write and then publish) from the Socket.io layer (which relays to rooms).
export type BoardEventType =
  | "card:created" | "card:updated" | "card:moved" | "card:deleted"
  | "column:created" | "column:updated" | "column:deleted"
  | "board:updated" | "board:deleted"
  | "member:joined" | "member:left"
  | "activity:new";

export type BoardEvent = { type: BoardEventType; payload: unknown; clientMutationId?: string };
type Publisher = (boardId: string, event: BoardEvent) => void;

const recorded: { boardId: string; event: BoardEvent }[] = [];
// Default publisher only records (tests and before the socket layer is attached).
let publisher: Publisher = (boardId, event) => {
  recorded.push({ boardId, event });
};

export const publish = (boardId: string, event: BoardEvent) => publisher(boardId, event);
export const setPublisher = (fn: Publisher) => {
  publisher = fn;
};

const revokeListeners: ((boardId: string, userId: string) => void)[] = [];
export const onMembershipRevoked = (fn: (boardId: string, userId: string) => void) => {
  revokeListeners.push(fn);
};
export const revokeMembership = (boardId: string, userId: string) => {
  for (const fn of revokeListeners) fn(boardId, userId);
};

export const recordedEvents = () => recorded;
export const clearRecorded = () => {
  recorded.length = 0;
};
