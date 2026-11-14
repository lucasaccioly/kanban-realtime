import { getBoardState, type Actor, type BoardState } from "../boards/service.js";
import { createCard, moveCard, updateCard } from "../cards/service.js";
import { prisma } from "../db.js";
import { boardsWithHumansOnline } from "../realtime/presence.js";
import { ensureBot } from "../seed/guestBoard.js";

const IDEAS = [
  "Revisar textos da página inicial",
  "Ajustar cores do tema escuro",
  "Adicionar filtro por etiqueta",
  "Documentar a API no README",
  "Corrigir layout no celular",
  "Criar testes do checkout",
  "Otimizar imagens do site",
  "Revisar mensagens de erro",
];
const MAX_CARDS = 15; // keep the demo board readable

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

/** One action through the same services a human uses, so it flows through validation, activity and realtime. */
async function actOnce(bot: Actor, state: BoardState) {
  const cards = state.columns.flatMap((c) => c.cards);
  const choices: (() => Promise<unknown>)[] = [];
  if (cards.length > 0 && state.columns.length > 1) {
    choices.push(() => {
      const card = pick(cards);
      const i = state.columns.findIndex((c) => c.id === card.columnId);
      const next = state.columns[(i + 1) % state.columns.length];
      return moveCard(bot, card.id, { columnId: next.id, afterCardId: null, version: card.version });
    });
  }
  if (cards.length < MAX_CARDS && state.columns.length > 0) {
    choices.push(() => createCard(bot, state.columns[0].id, { title: pick(IDEAS), labels: [pick(["feature", "melhoria", "bug"])] }));
  }
  if (cards.length > 0 && state.members.length > 0) {
    choices.push(() => updateCard(bot, pick(cards).id, { assigneeId: pick(state.members).id }));
  }
  if (choices.length === 0) return false;
  await pick(choices)();
  return true;
}

export async function botTick(_now: Date): Promise<number> {
  const boardIds = boardsWithHumansOnline();
  if (boardIds.length === 0) return 0;
  const bot = await ensureBot();
  const boards = await prisma.board.findMany({
    where: { id: { in: boardIds }, isGuestDemo: true, botPaused: false, members: { some: { userId: bot.id } } },
  });
  let done = 0;
  for (const board of boards) {
    try {
      if (await actOnce(bot, await getBoardState(board.id))) done++;
    } catch (e) {
      console.error("bot action failed", board.id, e); // e.g. board deleted mid-tick; try again next tick
    }
  }
  return done;
}

export function startBot(intervalMs = Number(process.env.BOT_INTERVAL_MS ?? 20000)) {
  let running = false;
  setInterval(async () => {
    if (running) return; // never overlap ticks
    running = true;
    await botTick(new Date()).catch((e) => console.error("bot tick failed", e));
    running = false;
  }, intervalMs).unref();
}
