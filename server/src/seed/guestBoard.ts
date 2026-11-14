import { generateNKeysBetween } from "fractional-indexing";
import { prisma, type Tx } from "../db.js";

export const BOT_EMAIL = "bia.bot@flowboard.dev";
export const BOT_NAME = "Bia (bot)";
export const DEFAULT_COLUMNS = ["A fazer", "Fazendo", "Feito"];

export function ensureBot(tx: Tx = prisma) {
  return tx.user.upsert({
    where: { email: BOT_EMAIL },
    update: {},
    create: { email: BOT_EMAIL, name: BOT_NAME, isBot: true },
  });
}

const DAY = 24 * 60 * 60 * 1000;

type Sample = { col: number; title: string; labels: string[]; who: "guest" | "bot" | null; dueInDays: number | null };
const SAMPLE: Sample[] = [
  { col: 0, title: "Tela de login", labels: ["feature"], who: "guest", dueInDays: 3 },
  { col: 0, title: "Corrigir cálculo do frete", labels: ["bug", "urgente"], who: "bot", dueInDays: -2 },
  { col: 0, title: "Escrever testes do carrinho", labels: ["melhoria"], who: null, dueInDays: null },
  { col: 0, title: "Página de perfil", labels: ["feature"], who: null, dueInDays: 7 },
  { col: 1, title: "Integração com pagamento", labels: ["feature", "urgente"], who: "bot", dueInDays: 1 },
  { col: 1, title: "Melhorar performance da busca", labels: ["melhoria"], who: "guest", dueInDays: null },
  { col: 2, title: "Configurar CI", labels: ["melhoria"], who: "bot", dueInDays: null },
  { col: 2, title: "Erro 500 ao salvar endereço", labels: ["bug"], who: "guest", dueInDays: null },
];

export async function createGuestDemoBoard(tx: Tx, guestId: string): Promise<string> {
  const bot = await ensureBot(tx);
  const guest = await tx.user.findUniqueOrThrow({ where: { id: guestId } });
  const board = await tx.board.create({
    data: {
      name: "Projeto de exemplo",
      ownerId: guestId,
      isGuestDemo: true,
      members: { create: [{ userId: guestId }, { userId: bot.id }] },
    },
  });
  const columnKeys = generateNKeysBetween(null, null, DEFAULT_COLUMNS.length);
  const now = Date.now();
  for (const [ci, name] of DEFAULT_COLUMNS.entries()) {
    const column = await tx.column.create({ data: { boardId: board.id, name, position: columnKeys[ci] } });
    const rows = SAMPLE.filter((s) => s.col === ci);
    const keys = generateNKeysBetween(null, null, rows.length);
    await tx.card.createMany({
      data: rows.map((s, i) => ({
        columnId: column.id,
        title: s.title,
        labels: s.labels,
        position: keys[i],
        assigneeId: s.who === "guest" ? guestId : s.who === "bot" ? bot.id : null,
        dueDate: s.dueInDays === null ? null : new Date(now + s.dueInDays * DAY),
      })),
    });
  }
  const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000); // distinct timestamps keep the feed order stable
  await tx.activity.createMany({
    data: [
      { boardId: board.id, actorId: guestId, actorName: guest.name, type: "board.created", payload: { name: board.name }, createdAt: at(2) },
      { boardId: board.id, actorId: bot.id, actorName: bot.name, type: "member.joined", payload: {}, createdAt: at(1) },
      {
        boardId: board.id,
        actorId: bot.id,
        actorName: bot.name,
        type: "card.moved",
        payload: { title: "Configurar CI", fromColumn: "Fazendo", toColumn: "Feito" },
        createdAt: at(0),
      },
    ],
  });
  return board.id;
}
