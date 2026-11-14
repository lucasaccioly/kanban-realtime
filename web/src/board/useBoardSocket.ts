import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { io, type Socket } from "socket.io-client";
import { API_URL, getToken } from "../api/client";
import { SERVER_EVENTS, type BoardState, type Presence } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { boardReducer, initialClientState, type BoardAction, type ClientBoardState } from "./reducer";

export type Connection = "connecting" | "live" | "reconnecting";
type JoinAck = { ok: true; state: BoardState } | { ok: false; error: string };

const EMPTY: ClientBoardState = initialClientState({
  board: { id: "", name: "", ownerId: "", inviteToken: null, isGuestDemo: false, botPaused: false },
  members: [],
  columns: [],
  activity: [],
});

export const REMOVED_TOAST = "Você não tem mais acesso a este quadro";

/** Live board: joins the room on every (re)connect and replaces local state with the server's. */
export function useBoardSocket(boardId: string) {
  const [state, dispatch] = useReducer(boardReducer, EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [presence, setPresence] = useState<Presence>({ boardId, online: [], editing: {} });
  const socketRef = useRef<Socket | null>(null);
  const navigate = useNavigate();
  const { signOut } = useAuth();

  useEffect(() => {
    const leave = (toast?: string) => navigate("/quadros", { replace: true, state: toast ? { toast } : undefined });
    const socket = io(API_URL, { auth: { token: getToken() }, transports: ["websocket", "polling"] });
    socketRef.current = socket;

    let retry: ReturnType<typeof setTimeout> | undefined;
    const join = async () => {
      const ack: JoinAck = await socket.emitWithAck("board:join", { boardId });
      if (!ack.ok && ack.error === "Não encontrado") return leave("Quadro não encontrado");
      if (!ack.ok) {
        retry = setTimeout(() => socket.connected && void join(), 3000); // transient (e.g. database waking up)
        return;
      }
      dispatch({ type: "reset", state: ack.state });
      setLoaded(true);
      setConnection("live");
    };
    socket.on("connect", join);
    socket.on("disconnect", () => setConnection("reconnecting"));
    socket.on("connect_error", (err) => {
      if (err.message === "Não autenticado") signOut();
      setConnection((c) => (c === "connecting" ? c : "reconnecting"));
    });
    for (const type of SERVER_EVENTS) {
      socket.on(type, (payload) => dispatch({ type, payload } as BoardAction));
    }
    socket.on("presence:update", (p: Presence) => p.boardId === boardId && setPresence(p));
    socket.on("board:deleted", () => leave("Este quadro foi apagado"));
    socket.on("board:removed", () => leave(REMOVED_TOAST));

    return () => {
      clearTimeout(retry);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [boardId, navigate, signOut]);

  const focusCard = useCallback(
    (cardId: string | null) => socketRef.current?.emit("card:focus", { boardId, cardId }),
    [boardId],
  );

  /** Re-fetch the authoritative state, e.g. after a failed optimistic mutation. */
  const resync = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    const ack: JoinAck = await socket.emitWithAck("board:join", { boardId });
    if (ack.ok) dispatch({ type: "reset", state: ack.state });
  }, [boardId]);

  return { state, dispatch, loaded, connection, presence, focusCard, resync };
}
