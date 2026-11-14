import type { Member, Presence } from "../api/types";
import { Avatar, cx } from "../components/ui";
import type { Connection } from "./useBoardSocket";

const PILL: Record<Connection, [string, string]> = {
  live: ["Ao vivo", "bg-emerald-100 text-emerald-700"],
  connecting: ["Conectando…", "bg-slate-100 text-slate-600"],
  reconnecting: ["Reconectando…", "bg-amber-100 text-amber-800"],
};

export function PresenceBar({ members, presence, connection }: { members: Member[]; presence: Presence; connection: Connection }) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const online = presence.online.map((id) => byId.get(id)).filter((m): m is Member => !!m);
  const [label, style] = PILL[connection];
  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2" aria-label={`Online: ${online.map((m) => m.name).join(", ")}`}>
        {online.map((m) => (
          <Avatar key={m.id} id={m.id} name={m.name} ring />
        ))}
      </div>
      <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", style)}>
        <span className={cx("h-1.5 w-1.5 rounded-full bg-current", connection === "live" && "animate-pulse")} />
        {label}
      </span>
    </div>
  );
}
