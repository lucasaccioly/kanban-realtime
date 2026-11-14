import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { send } from "../api/client";
import { Card, ErrorBox, Logo, Spinner } from "../components/ui";

export function JoinInvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false); // StrictMode runs effects twice in dev

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    send<{ boardId: string }>("POST", `/api/invites/${encodeURIComponent(token ?? "")}/join`)
      .then((r) => navigate(`/quadros/${r.boardId}`, { replace: true }))
      .catch((e) => setError(e?.status === 404 ? new Error("Convite inválido ou revogado.") : e));
  }, [token, navigate]);

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 px-4 py-12">
      <Logo />
      <Card className="w-full text-center">
        {error ? (
          <>
            <ErrorBox error={error} />
            <Link to="/quadros" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:underline">
              Ir para meus quadros
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">Entrando no quadro…</p>
            <Spinner />
          </>
        )}
      </Card>
    </div>
  );
}
