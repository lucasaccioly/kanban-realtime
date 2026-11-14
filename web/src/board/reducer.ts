import { generateKeyBetween } from "fractional-indexing";
import type { BoardState, CardDto, ColumnDto, ServerEvent } from "../api/types";

/** pending: mutationId → cardId of our optimistic moves still waiting for the server echo. */
export type ClientBoardState = BoardState & { pending: Record<string, string> };

export type BoardAction =
  | ServerEvent
  | { type: "optimistic:move"; cardId: string; columnId: string; afterCardId: string | null; mutationId: string }
  | { type: "reset"; state: BoardState };

export const initialClientState = (state: BoardState): ClientBoardState => ({ ...state, pending: {} });

const byPosition = (a: { position: string }, b: { position: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

const findCard = (s: BoardState, id: string) => s.columns.flatMap((c) => c.cards).find((c) => c.id === id);

const withoutCard = (columns: ColumnDto[], id: string) =>
  columns.map((c) => (c.cards.some((k) => k.id === id) ? { ...c, cards: c.cards.filter((k) => k.id !== id) } : c));

/** Removes the card wherever it is and inserts it (sorted) into card.columnId, if that column exists. */
const placeCard = (columns: ColumnDto[], card: CardDto) =>
  withoutCard(columns, card.id).map((c) => (c.id === card.columnId ? { ...c, cards: [...c.cards, card].sort(byPosition) } : c));

const dropPending = (pending: Record<string, string>, pred: (mutationId: string, cardId: string) => boolean) =>
  Object.fromEntries(Object.entries(pending).filter(([m, c]) => !pred(m, c)));

/** Server is the source of truth: its events always win; optimistic moves only bridge the round trip. */
export function boardReducer(state: ClientBoardState, action: BoardAction): ClientBoardState {
  switch (action.type) {
    case "reset":
      return initialClientState(action.state);

    case "optimistic:move": {
      const moving = findCard(state, action.cardId);
      const target = state.columns.find((c) => c.id === action.columnId);
      if (!moving || !target) return state;
      const siblings = target.cards.filter((c) => c.id !== action.cardId);
      const i = action.afterCardId === null ? -1 : siblings.findIndex((c) => c.id === action.afterCardId);
      if (action.afterCardId !== null && i < 0) return state;
      let position: string;
      try {
        position = generateKeyBetween(siblings[i]?.position ?? null, siblings[i + 1]?.position ?? null);
      } catch {
        return state; // unexpected keys: skip the optimistic step, the server echo will place it
      }
      return {
        ...state,
        columns: placeCard(state.columns, { ...moving, columnId: target.id, position }),
        pending: { ...state.pending, [action.mutationId]: action.cardId },
      };
    }

    case "card:created":
    case "card:updated":
    case "card:moved": {
      const { clientMutationId, ...card } = action.payload;
      const pending = clientMutationId ? dropPending(state.pending, (m) => m === clientMutationId) : state.pending;
      const current = findCard(state, card.id);
      if (current && current.version > card.version) return { ...state, pending }; // late, out-of-order event
      return { ...state, columns: placeCard(state.columns, card), pending };
    }

    case "card:deleted":
      return {
        ...state,
        columns: withoutCard(state.columns, action.payload.id),
        pending: dropPending(state.pending, (_m, cardId) => cardId === action.payload.id),
      };

    case "column:created": {
      const { clientMutationId: _, ...column } = action.payload;
      if (state.columns.some((c) => c.id === column.id)) return state;
      return { ...state, columns: [...state.columns, column].sort(byPosition) };
    }

    case "column:updated": {
      const { id, name, position } = action.payload;
      return { ...state, columns: state.columns.map((c) => (c.id === id ? { ...c, name, position } : c)).sort(byPosition) };
    }

    case "column:deleted": {
      const gone = state.columns.find((c) => c.id === action.payload.id);
      const goneCards = new Set(gone?.cards.map((c) => c.id));
      return {
        ...state,
        columns: state.columns.filter((c) => c.id !== action.payload.id),
        pending: dropPending(state.pending, (_m, cardId) => goneCards.has(cardId)),
      };
    }

    case "board:updated": {
      const { clientMutationId: _, ...patch } = action.payload;
      return { ...state, board: { ...state.board, ...patch } };
    }

    case "member:joined": {
      const { clientMutationId: _, ...member } = action.payload;
      if (state.members.some((m) => m.id === member.id)) return state;
      return { ...state, members: [...state.members, member] };
    }

    case "member:left":
      return { ...state, members: state.members.filter((m) => m.id !== action.payload.userId) };

    case "activity:new": {
      const { clientMutationId: _, ...activity } = action.payload;
      if (state.activity.some((a) => a.id === activity.id)) return state;
      return { ...state, activity: [activity, ...state.activity].slice(0, 50) };
    }
  }
}

export type MoveRequest = { cardId: string; columnId: string; afterCardId: string | null };

/** Where a drop lands, as "after which card" in the target column (null = top). */
export function dropTarget(state: BoardState, activeId: string, overId: string): MoveRequest | null {
  const column = state.columns.find((c) => c.id === overId);
  if (column) {
    const rest = column.cards.filter((c) => c.id !== activeId);
    return { cardId: activeId, columnId: column.id, afterCardId: rest.at(-1)?.id ?? null };
  }
  const target = state.columns.find((c) => c.cards.some((k) => k.id === overId));
  if (!target) return null;
  const from = target.cards.findIndex((c) => c.id === activeId);
  const overIndex = target.cards.findIndex((c) => c.id === overId);
  const rest = target.cards.filter((c) => c.id !== activeId);
  // Same column moving down: land after the hovered card; otherwise take its place (before it).
  const insertAt = from >= 0 && from < overIndex ? overIndex : rest.findIndex((c) => c.id === overId);
  return { cardId: activeId, columnId: target.id, afterCardId: rest[insertAt - 1]?.id ?? null };
}
