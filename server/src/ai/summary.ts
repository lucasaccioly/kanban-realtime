import type { BoardState } from "../boards/service.js";

const DAY = 24 * 60 * 60 * 1000;
const STALE_DAYS = 3;
const MAX_LISTED = 15;

const list = (titles: string[]) =>
  titles.length === 0 ? "nenhum" : titles.slice(0, MAX_LISTED).map((t) => `"${t.replaceAll('"', "'")}"`).join(", ");

/** pt-BR prompt with the facts the model needs; the last column counts as "done". */
export function buildSummaryPrompt(state: BoardState, now: Date): string {
  const last = state.columns.at(-1)?.id;
  const open = state.columns.filter((c) => c.id !== last).flatMap((c) => c.cards);
  const today = new Date(utcDayStart(now));
  const overdue = open.filter((c) => c.dueDate && new Date(c.dueDate) < today).map((c) => c.title);
  const stale = open.filter((c) => now.getTime() - new Date(c.updatedAt).getTime() >= STALE_DAYS * DAY).map((c) => c.title);
  const names = new Map(state.members.map((m) => [m.id, m.name]));
  const perColumn = state.columns.map((c) => `${c.name}: ${c.cards.length}`).join("\n");
  const unassigned = open.filter((c) => !c.assigneeId || !names.has(c.assigneeId)).length;

  return [
    `Quadro Kanban "${state.board.name}". Cartões por coluna (a última coluna é "concluído"):`,
    perColumn,
    `Cartões atrasados (prazo vencido): ${list(overdue)}`,
    `Cartões parados (sem mudança há ${STALE_DAYS}+ dias): ${list(stale)}`,
    `Cartões abertos sem responsável: ${unassigned}`,
    "",
    "Escreva em português do Brasil, no máximo 120 palavras, em três partes curtas com estes títulos:",
    "Progresso, Riscos, Próximos passos. Não invente cartões que não estão na lista.",
  ].join("\n");
}

const utcDayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
