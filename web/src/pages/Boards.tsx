import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { apiFetch, send } from "../api/client";
import type { BoardState, BoardSummary } from "../api/types";
import { AppHeader } from "../components/AppHeader";
import { Button, Card, EmptyState, ErrorBox, Input, PageHeader, Spinner } from "../components/ui";

export function BoardsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const toast = (useLocation().state as { toast?: string } | null)?.toast;
  const boards = useQuery({
    queryKey: ["boards"],
    queryFn: () => apiFetch<{ boards: BoardSummary[] }>("/api/boards").then((r) => r.boards),
  });
  const create = useMutation({
    mutationFn: (n: string) => send<BoardState>("POST", "/api/boards", { name: n }),
    onSuccess: (state) => {
      qc.invalidateQueries({ queryKey: ["boards"] });
      navigate(`/quadros/${state.board.id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  };

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        {toast && (
          <p role="status" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {toast}
          </p>
        )}
        <PageHeader title="Meus quadros" subtitle="Quadros que você criou ou dos quais participa." />
        <Card className="mb-6">
          <form onSubmit={submit} className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do novo quadro" maxLength={80} aria-label="Nome do novo quadro" />
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              <Plus size={16} /> Criar
            </Button>
          </form>
          <div className="mt-2">
            <ErrorBox error={create.error} />
          </div>
        </Card>
        {boards.isPending ? (
          <Spinner />
        ) : boards.error ? (
          <ErrorBox error={boards.error} />
        ) : boards.data.length === 0 ? (
          <EmptyState title="Nenhum quadro ainda">Crie o primeiro acima ou abra um link de convite.</EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {boards.data.map((b) => (
              <li key={b.id}>
                <Link to={`/quadros/${b.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 hover:shadow">
                  <p className="font-medium text-slate-900">{b.name}</p>
                  <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
                    <Users size={14} /> {b.memberCount} {b.memberCount === 1 ? "membro" : "membros"} · {b.isOwner ? "dono" : "membro"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
