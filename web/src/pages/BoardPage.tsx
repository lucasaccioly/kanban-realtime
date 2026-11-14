import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { apiFetch } from "../api/client";
import type { BoardState } from "../api/types";
import { BoardView } from "../board/BoardView";
import { AppHeader } from "../components/AppHeader";
import { ErrorBox, Spinner } from "../components/ui";

// Task 8 placeholder (REST snapshot); Task 9 replaces it with the realtime board.
export function BoardPage() {
  const { id } = useParams();
  const board = useQuery({ queryKey: ["board", id], queryFn: () => apiFetch<BoardState>(`/api/boards/${id}`) });
  return (
    <div className="min-h-screen">
      <AppHeader>{board.data && <h1 className="truncate font-semibold">{board.data.board.name}</h1>}</AppHeader>
      <main className="p-4">
        {board.isPending ? <Spinner /> : board.error ? <ErrorBox error={board.error} /> : <BoardView state={board.data} />}
      </main>
    </div>
  );
}
