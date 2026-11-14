import { Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { LABELS, type CardDto, type Member } from "../api/types";
import { Button, cx, ErrorBox, Field, Input, LABEL_STYLES, Modal, Select } from "../components/ui";

export type CardPatch = {
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null;
  labels: string[];
};

type Props = {
  card: CardDto;
  members: Member[];
  onSave: (patch: CardPatch) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
};

export function CardModal({ card, members, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState<CardPatch>(() => ({
    title: card.title,
    description: card.description,
    assigneeId: card.assigneeId,
    dueDate: card.dueDate?.slice(0, 10) ?? null,
    labels: card.labels,
  }));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Someone else changed this card while it is open: keep the user's edits but warn.
  const [changedBy, setChangedBy] = useState(false);
  const [openVersion] = useState(card.version);
  useEffect(() => setChangedBy(card.version !== openVersion), [card.version, openVersion]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => onSave({ ...form, title: form.title.trim() }));
  };
  const toggleLabel = (l: string) =>
    setForm((f) => ({ ...f, labels: f.labels.includes(l) ? f.labels.filter((x) => x !== l) : [...f.labels, l] }));

  return (
    <Modal title="Editar cartão" open onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {changedBy && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Outra pessoa alterou este cartão enquanto você editava. Salvar sobrescreve com os seus campos.
          </p>
        )}
        <Field label="Título">
          <Input value={form.title} maxLength={120} required onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Descrição">
          <textarea
            value={form.description}
            maxLength={2000}
            rows={4}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Responsável">
            <Select value={form.assigneeId ?? ""} onChange={(e) => setForm({ ...form, assigneeId: e.target.value || null })}>
              <option value="">Ninguém</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prazo">
            <Input type="date" value={form.dueDate ?? ""} onChange={(e) => setForm({ ...form, dueDate: e.target.value || null })} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Etiquetas</legend>
          <div className="flex flex-wrap gap-2">
            {LABELS.map((l) => (
              <button
                type="button"
                key={l}
                aria-pressed={form.labels.includes(l)}
                onClick={() => toggleLabel(l)}
                className={cx(
                  "rounded-full px-3 py-1 text-xs font-medium ring-1 transition",
                  form.labels.includes(l) ? cx(LABEL_STYLES[l], "ring-transparent") : "bg-white text-slate-500 ring-slate-300",
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </fieldset>
        <ErrorBox error={error} />
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" className="text-rose-600" disabled={busy} onClick={() => void run(onDelete)}>
            <Trash2 size={15} /> Apagar
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !form.title.trim()}>
              Salvar
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
