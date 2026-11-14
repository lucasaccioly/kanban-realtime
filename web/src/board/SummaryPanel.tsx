import { Sparkles } from "lucide-react";
import { useState } from "react";
import { send } from "../api/client";
import { Button } from "../components/ui";

export function SummaryPanel({ boardId }: { boardId: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setSummary((await send<{ summary: string }>("POST", `/api/boards/${boardId}/summary`)).summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Resumo por IA" className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
      <Button variant="secondary" className="w-full" onClick={run} disabled={busy}>
        <Sparkles size={15} className="text-indigo-600" /> {busy ? "Resumindo…" : "Resumir quadro"}
      </Button>
      <div aria-live="polite">
        {error && <p className="mt-3 text-sm text-amber-800">{error}</p>}
        {summary && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">{summary}</p>}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">Gerado por IA (Llama via Groq). Até 5 resumos por dia.</p>
    </section>
  );
}
