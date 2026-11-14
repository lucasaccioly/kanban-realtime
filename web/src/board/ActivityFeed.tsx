import { useEffect, useState } from "react";
import type { ActivityDto } from "../api/types";

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  if (s > -45) return "agora";
  const m = Math.round(s / 60);
  if (m > -60) return rtf.format(m, "minute");
  const h = Math.round(m / 60);
  if (h > -24) return rtf.format(h, "hour");
  return rtf.format(Math.round(h / 24), "day");
}

const q = (v: unknown) => `"${String(v ?? "")}"`;

export function describe(a: ActivityDto): string {
  const p = a.payload;
  switch (a.type) {
    case "card.created": return `criou ${q(p.title)} em ${p.column}`;
    case "card.moved": return `moveu ${q(p.title)} para ${p.toColumn}`;
    case "card.updated": return `editou ${q(p.title)}`;
    case "card.deleted": return `apagou ${q(p.title)}`;
    case "column.created": return `criou a coluna ${q(p.name)}`;
    case "column.renamed": return `renomeou a coluna ${q(p.from)} para ${q(p.to)}`;
    case "column.deleted": return `apagou a coluna ${q(p.name)}`;
    case "board.created": return "criou o quadro";
    case "board.renamed": return `renomeou o quadro para ${q(p.to)}`;
    case "member.joined": return "entrou no quadro";
    case "member.left": return "saiu do quadro";
    case "member.removed": return `removeu ${p.name}`;
    default: return a.type;
  }
}

export function ActivityFeed({ activity }: { activity: ActivityDto[] }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000); // keep "há 2 min" fresh
    return () => clearInterval(t);
  }, []);
  return (
    <section aria-label="Histórico">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Histórico</h2>
      {activity.length === 0 ? (
        <p className="text-sm text-slate-500">Nada por aqui ainda.</p>
      ) : (
        <ol className="space-y-2" aria-live="polite">
          {activity.map((a) => (
            <li key={a.id} className="text-sm leading-snug text-slate-600">
              <span className="font-medium text-slate-800">{a.actorName}</span> {describe(a)}{" "}
              <time dateTime={a.createdAt} className="text-xs text-slate-400">
                {timeAgo(a.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
