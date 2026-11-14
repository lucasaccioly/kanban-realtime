import type { BoardState, CardDto } from "../api/types";
import { Avatar, LabelChip } from "../components/ui";

// Task 8: read-only render used by the landing preview; Task 9 adds drag and drop and editing.
export function BoardView({ state }: { state: BoardState; readOnly?: boolean }) {
  const members = new Map(state.members.map((m) => [m.id, m]));
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {state.columns.map((col) => (
        <section key={col.id} className="w-72 shrink-0 rounded-xl bg-slate-100 p-3" aria-label={col.name}>
          <h2 className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-700">
            {col.name} <span className="text-xs font-normal text-slate-400">{col.cards.length}</span>
          </h2>
          <ul className="space-y-2">
            {col.cards.map((c) => (
              <li key={c.id}>
                <CardFace card={c} assignee={c.assigneeId ? members.get(c.assigneeId) : undefined} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CardFace({ card, assignee }: { card: CardDto; assignee?: { id: string; name: string } }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      {card.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <LabelChip key={l} label={l} />
          ))}
        </div>
      )}
      <p className="text-sm text-slate-800">{card.title}</p>
      {assignee && (
        <div className="mt-2 flex justify-end">
          <Avatar id={assignee.id} name={assignee.name} size={22} />
        </div>
      )}
    </div>
  );
}
