import { Bot, Pause, Pencil, Play, Share2 } from "lucide-react";
import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { send } from "../api/client";
import type { CardDto, ColumnDto } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ActivityFeed } from "../board/ActivityFeed";
import { BoardView, type BoardActions } from "../board/BoardView";
import { CardModal, type CardPatch } from "../board/CardModal";
import { PresenceBar } from "../board/PresenceBar";
import { ShareDialog } from "../board/ShareDialog";
import { SummaryPanel } from "../board/SummaryPanel";
import { useBoardSocket } from "../board/useBoardSocket";
import { AppHeader } from "../components/AppHeader";
import { Button, ErrorBox, Spinner } from "../components/ui";

export function BoardPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { state, dispatch, loaded, connection, presence, focusCard, resync } = useBoardSocket(id);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const selfId = user?.id ?? "";
  const isOwner = state.board.ownerId === selfId;
  const openCard = useMemo(
    () => (openCardId ? state.columns.flatMap((c) => c.cards).find((c) => c.id === openCardId) : undefined),
    [state.columns, openCardId],
  );

  /** Mutations go over REST; the socket event that follows updates every client, this one included. */
  const call = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e);
        await resync(); // drop any optimistic change the server refused
      }
    },
    [resync],
  );

  const closeCard = useCallback(() => {
    setOpenCardId(null);
    focusCard(null);
  }, [focusCard]);

  const actions: BoardActions = {
    moveCard: (m) => {
      const card = state.columns.flatMap((c) => c.cards).find((c) => c.id === m.cardId);
      if (!card) return;
      const mutationId = crypto.randomUUID();
      dispatch({ type: "optimistic:move", ...m, mutationId });
      void call(() => send("POST", `/api/cards/${m.cardId}/move`, { columnId: m.columnId, afterCardId: m.afterCardId, version: card.version }, mutationId));
    },
    openCard: (card: CardDto) => {
      setOpenCardId(card.id);
      focusCard(card.id);
    },
    addCard: (columnId, title) => void call(() => send("POST", `/api/columns/${columnId}/cards`, { title })),
    addColumn: (name) => void call(() => send("POST", `/api/boards/${id}/columns`, { name })),
    renameColumn: (columnId, name) => void call(() => send("PATCH", `/api/columns/${columnId}`, { name })),
    deleteColumn: (column: ColumnDto) => {
      const n = column.cards.length;
      if (n > 0 && !window.confirm(`Apagar a coluna "${column.name}" e ${n === 1 ? "1 cartão" : `${n} cartões`}?`)) return;
      void call(() => send("DELETE", `/api/columns/${column.id}`));
    },
  };

  const renameBoard = (e: FormEvent) => {
    e.preventDefault();
    const name = renaming?.trim();
    setRenaming(null);
    if (name && name !== state.board.name) void call(() => send("PATCH", `/api/boards/${id}`, { name }));
  };

  if (!loaded) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader>
        {renaming !== null ? (
          <form onSubmit={renameBoard} className="min-w-0">
            <input
              autoFocus
              value={renaming}
              maxLength={80}
              onChange={(e) => setRenaming(e.target.value)}
              onBlur={renameBoard}
              aria-label="Nome do quadro"
              className="rounded border border-indigo-300 px-2 py-1 font-semibold"
            />
          </form>
        ) : (
          <h1 className="flex min-w-0 items-center gap-1 truncate font-semibold">
            {state.board.name}
            {isOwner && (
              <button onClick={() => setRenaming(state.board.name)} aria-label="Renomear quadro" className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <Pencil size={14} />
              </button>
            )}
          </h1>
        )}
        <div className="ml-auto flex items-center gap-2">
          <PresenceBar members={state.members} presence={presence} connection={connection} />
          {state.board.isGuestDemo && (
            <Button
              variant="ghost"
              className="px-2"
              onClick={() => call(() => send("PATCH", `/api/boards/${id}/bot`, { paused: !state.board.botPaused }))}
              aria-label={state.board.botPaused ? "Retomar a Bia" : "Pausar a Bia"}
              title={state.board.botPaused ? "Retomar a Bia (bot)" : "Pausar a Bia (bot)"}
            >
              <Bot size={16} /> {state.board.botPaused ? <Play size={14} /> : <Pause size={14} />}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setSharing(true)}>
            <Share2 size={15} /> <span className="hidden sm:inline">Compartilhar</span>
          </Button>
        </div>
      </AppHeader>

      {state.board.isGuestDemo && (
        <p className="bg-indigo-50 px-4 py-2 text-sm text-indigo-800">
          A <strong>Bia (bot)</strong> mexe neste quadro a cada ~20 s enquanto você está aqui. Para ver o tempo real entre
          pessoas, use <strong>Compartilhar</strong> e abra o link em outra janela anônima.
        </p>
      )}
      {error !== null && (
        <div className="px-4 pt-3">
          <ErrorBox error={error} />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        <main className="min-w-0 flex-1">
          <BoardView state={state} actions={actions} editing={presence.editing} selfId={selfId} />
        </main>
        <aside className="w-full shrink-0 space-y-4 lg:w-80">
          <SummaryPanel boardId={id} />
          <ActivityFeed activity={state.activity} />
        </aside>
      </div>

      {openCard && (
        <CardModal
          card={openCard}
          members={state.members}
          onClose={closeCard}
          onSave={(patch: CardPatch) => send("PATCH", `/api/cards/${openCard.id}`, patch)}
          onDelete={() => send("DELETE", `/api/cards/${openCard.id}`)}
        />
      )}
      {sharing && (
        <ShareDialog
          state={state}
          selfId={selfId}
          onClose={() => setSharing(false)}
          onInviteChange={(inviteToken) => dispatch({ type: "board:updated", payload: { inviteToken } })}
        />
      )}
    </div>
  );
}
