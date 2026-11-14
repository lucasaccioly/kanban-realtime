import type { BoardState, CardDto } from "../api/types";

// Static, read-only board shown on the landing page while the API wakes up (no request needed).
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString();
let n = 0;
const card = (columnId: string, title: string, labels: string[], assigneeId: string | null, due: number | null): CardDto => ({
  id: `p${++n}`,
  columnId,
  title,
  description: "",
  assigneeId,
  dueDate: due === null ? null : day(due),
  labels,
  position: `a${n}`,
  version: 0,
  updatedAt: day(0),
});

export const previewBoard: BoardState = {
  board: { id: "preview", name: "Projeto de exemplo", ownerId: "ana", inviteToken: null, isGuestDemo: true, botPaused: false },
  members: [
    { id: "ana", name: "Ana", isBot: false },
    { id: "bia", name: "Bia (bot)", isBot: true },
  ],
  columns: [
    {
      id: "todo",
      name: "A fazer",
      position: "a0",
      cards: [
        card("todo", "Tela de login", ["feature"], "ana", 3),
        card("todo", "Corrigir cálculo do frete", ["bug", "urgente"], "bia", -2),
        card("todo", "Escrever testes do carrinho", ["melhoria"], null, null),
        card("todo", "Página de perfil", ["feature"], null, 7),
      ],
    },
    {
      id: "doing",
      name: "Fazendo",
      position: "a1",
      cards: [
        card("doing", "Integração com pagamento", ["feature", "urgente"], "bia", 1),
        card("doing", "Melhorar performance da busca", ["melhoria"], "ana", null),
      ],
    },
    {
      id: "done",
      name: "Feito",
      position: "a2",
      cards: [card("done", "Configurar CI", ["melhoria"], "bia", null), card("done", "Erro 500 ao salvar endereço", ["bug"], "ana", null)],
    },
  ],
  activity: [],
};
