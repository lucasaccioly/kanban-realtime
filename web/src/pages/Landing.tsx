import { Activity, Bot, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { send } from "../api/client";
import type { AuthResponse } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { BoardView } from "../board/BoardView";
import { useServerAwake, WakingBanner } from "../components/ServerStatus";
import { Button, ErrorBox, Logo } from "../components/ui";
import { previewBoard } from "../demo/previewBoard";

export function LandingPage() {
  const { user, signIn } = useAuth();
  const status = useServerAwake();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (user && !busy) return <Navigate to="/quadros" replace />; // busy: guest flow is navigating to its board

  const waking = status === "waking";
  const enterAsGuest = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await send<AuthResponse & { boardId: string }>("POST", "/api/auth/guest");
      signIn(r.token, r.user);
      navigate(`/quadros/${r.boardId}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen">
      {waking && <WakingBanner />}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Logo />
        <nav className="flex gap-2">
          <Button variant="ghost" disabled={waking} onClick={() => navigate("/entrar")}>Entrar</Button>
          <Button variant="secondary" disabled={waking} onClick={() => navigate("/cadastro")}>Criar conta</Button>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-8 pt-6">
        <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Kanban colaborativo que se atualiza ao vivo
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Arraste cartões e veja a mudança aparecer na hora para todo o time. Entre como visitante: a Bia, uma colega
          virtual, mexe no quadro com você para mostrar o tempo real funcionando.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={enterAsGuest} disabled={waking || busy}>
            {busy ? "Preparando seu quadro…" : "Entrar como visitante"}
          </Button>
          <span className="text-sm text-slate-500">Sem cadastro. Seu quadro de visitante dura 24 h.</span>
        </div>
        <div className="mt-3 max-w-md">
          <ErrorBox error={error} />
        </div>
        <ul className="mt-6 grid gap-3 text-sm text-slate-600 sm:grid-cols-4">
          <li className="flex items-center gap-2"><Activity size={16} className="text-indigo-600" /> Sincronização via WebSocket</li>
          <li className="flex items-center gap-2"><Users size={16} className="text-indigo-600" /> Presença e convites</li>
          <li className="flex items-center gap-2"><Bot size={16} className="text-indigo-600" /> Colega virtual na demo</li>
          <li className="flex items-center gap-2"><Sparkles size={16} className="text-indigo-600" /> Resumo do quadro por IA</li>
        </ul>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12" aria-label="Quadro de exemplo">
        <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Prévia (somente leitura)</p>
          <BoardView state={previewBoard} readOnly />
        </div>
      </section>
    </div>
  );
}
