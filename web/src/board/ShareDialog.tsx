import { Check, Copy, LogOut, UserMinus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { send } from "../api/client";
import type { BoardState } from "../api/types";
import { Avatar, Button, ErrorBox, Input, Modal } from "../components/ui";

type Props = {
  state: BoardState;
  selfId: string;
  onInviteChange: (inviteToken: string | null) => void;
  onClose: () => void;
};

export function ShareDialog({ state, selfId, onInviteChange, onClose }: Props) {
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const isOwner = state.board.ownerId === selfId;
  const id = state.board.id;
  const link = state.board.inviteToken ? `${window.location.origin}/convite/${state.board.inviteToken}` : null;

  const act = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
  };
  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal title="Compartilhar quadro" open onClose={onClose}>
      <div className="space-y-5">
        {isOwner && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-slate-700">Link de convite</h3>
            {link ? (
              <>
                <div className="flex gap-2">
                  <Input readOnly value={link} aria-label="Link de convite" onFocus={(e) => e.target.select()} />
                  <Button variant="secondary" onClick={copy} aria-label="Copiar link">
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  className="px-0 text-rose-600"
                  onClick={() => act(async () => {
                    await send("DELETE", `/api/boards/${id}/invite`);
                    onInviteChange(null);
                  })}
                >
                  Revogar link
                </Button>
              </>
            ) : (
              <Button
                onClick={() => act(async () => {
                  const r = await send<{ inviteToken: string }>("POST", `/api/boards/${id}/invite`);
                  onInviteChange(r.inviteToken);
                })}
              >
                Gerar link de convite
              </Button>
            )}
            <p className="text-xs text-slate-500">Quem abrir o link (logado ou como visitante) vira membro do quadro.</p>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-medium text-slate-700">Membros</h3>
          <ul className="space-y-2">
            {state.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <Avatar id={m.id} name={m.name} size={26} />
                <span className="flex-1">
                  {m.name}
                  {m.id === state.board.ownerId && <span className="ml-1 text-xs text-slate-400">(dono)</span>}
                  {m.id === selfId && <span className="ml-1 text-xs text-slate-400">(você)</span>}
                </span>
                {isOwner && m.id !== selfId && (
                  <Button
                    variant="ghost"
                    className="px-2"
                    aria-label={`Remover ${m.name}`}
                    onClick={() => act(() => send("DELETE", `/api/boards/${id}/members/${m.id}`))}
                  >
                    <UserMinus size={15} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <ErrorBox error={error} />

        {isOwner ? (
          <Button
            variant="danger"
            className="w-full"
            onClick={() => {
              if (!window.confirm(`Apagar o quadro "${state.board.name}" para todos os membros?`)) return;
              void act(async () => {
                await send("DELETE", `/api/boards/${id}`);
                navigate("/quadros", { replace: true });
              });
            }}
          >
            Apagar quadro
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => act(async () => {
              await send("POST", `/api/boards/${id}/leave`);
              navigate("/quadros", { replace: true });
            })}
          >
            <LogOut size={15} /> Sair do quadro
          </Button>
        )}
      </div>
    </Modal>
  );
}
