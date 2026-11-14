// Mirrors the server DTOs (server/src/boards/service.ts). Dates arrive as ISO strings.
export type User = { id: string; name: string; email: string | null; isGuest: boolean };
export type AuthResponse = { token: string; user: User };

export const LABELS = ["bug", "feature", "urgente", "melhoria"] as const;
export type Label = (typeof LABELS)[number];

export type CardDto = {
  id: string;
  columnId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null;
  labels: string[];
  position: string;
  version: number;
  updatedAt: string;
};
export type ColumnDto = { id: string; name: string; position: string; cards: CardDto[] };
export type Member = { id: string; name: string; isBot: boolean };
export type ActivityDto = { id: string; actorName: string; type: string; payload: Record<string, unknown>; createdAt: string };

export type BoardInfo = { id: string; name: string; ownerId: string; inviteToken: string | null; isGuestDemo: boolean; botPaused: boolean };
export type BoardState = { board: BoardInfo; members: Member[]; columns: ColumnDto[]; activity: ActivityDto[] };
export type BoardSummary = { id: string; name: string; isOwner: boolean; memberCount: number };

export type Presence = { boardId: string; online: string[]; editing: Record<string, string> };

/** Socket.io events relayed from the server bus; payload fields are spread next to clientMutationId. */
type WithMutation<T> = T & { clientMutationId?: string };
export type ServerEvent =
  | { type: "card:created" | "card:updated" | "card:moved"; payload: WithMutation<CardDto> }
  | { type: "card:deleted"; payload: WithMutation<{ id: string; columnId: string }> }
  | { type: "column:created"; payload: WithMutation<ColumnDto> }
  | { type: "column:updated"; payload: WithMutation<Omit<ColumnDto, "cards">> }
  | { type: "column:deleted"; payload: WithMutation<{ id: string }> }
  | { type: "board:updated"; payload: WithMutation<Partial<BoardInfo>> }
  | { type: "member:joined"; payload: WithMutation<Member> }
  | { type: "member:left"; payload: WithMutation<{ userId: string }> }
  | { type: "activity:new"; payload: WithMutation<ActivityDto> };

export const SERVER_EVENTS: ServerEvent["type"][] = [
  "card:created", "card:updated", "card:moved", "card:deleted",
  "column:created", "column:updated", "column:deleted",
  "board:updated", "member:joined", "member:left", "activity:new",
];
