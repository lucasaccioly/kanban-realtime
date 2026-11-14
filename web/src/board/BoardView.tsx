import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { BoardState, CardDto, ColumnDto, Member } from "../api/types";
import { Avatar, cx, LabelChip } from "../components/ui";
import { dropTarget, type MoveRequest } from "./reducer";


export type BoardActions = {
  moveCard: (m: MoveRequest) => void;
  openCard: (card: CardDto) => void;
  addCard: (columnId: string, title: string) => void;
  addColumn: (name: string) => void;
  renameColumn: (columnId: string, name: string) => void;
  deleteColumn: (column: ColumnDto) => void;
};

type Props = {
  state: BoardState;
  readOnly?: boolean;
  actions?: BoardActions;
  editing?: Record<string, string>; // cardId -> userId (presence)
  selfId?: string;
};

const isOverdue = (due: string | null) => !!due && new Date(due).getTime() < new Date().setUTCHours(0, 0, 0, 0);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });

export function BoardView({ state, readOnly, actions, editing = {}, selfId }: Props) {
  const members = new Map(state.members.map((m) => [m.id, m]));
  const [dragging, setDragging] = useState<CardDto | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over || active.id === over.id || !actions) return;
    const move = dropTarget(state, String(active.id), String(over.id));
    const card = state.columns.flatMap((c) => c.cards).find((c) => c.id === active.id);
    if (!move || !card) return;
    const col = state.columns.find((c) => c.id === card.columnId)!;
    const above = col.cards[col.cards.findIndex((c) => c.id === card.id) - 1]?.id ?? null;
    if (card.columnId !== move.columnId || above !== move.afterCardId) actions.moveCard(move);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={({ active }) => setDragging(state.columns.flatMap((c) => c.cards).find((c) => c.id === active.id) ?? null)}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-start gap-4 overflow-x-auto pb-4">
        {state.columns.map((col) => (
          <Column key={col.id} column={col} readOnly={readOnly} actions={actions}>
            {col.cards.map((c) => (
              <SortableCard
                key={c.id}
                card={c}
                disabled={readOnly}
                assignee={c.assigneeId ? members.get(c.assigneeId) : undefined}
                editor={editing[c.id] && editing[c.id] !== selfId ? members.get(editing[c.id]) : undefined}
                onOpen={actions ? () => actions.openCard(c) : undefined}
              />
            ))}
          </Column>
        ))}
        {!readOnly && actions && <AddColumn onAdd={actions.addColumn} />}
      </div>
      <DragOverlay>
        {dragging && <CardFace card={dragging} assignee={dragging.assigneeId ? members.get(dragging.assigneeId) : undefined} lifted />}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ column, readOnly, actions, children }: { column: ColumnDto; readOnly?: boolean; actions?: BoardActions; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: readOnly });
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  const [adding, setAdding] = useState("");

  const submitRename = (e: FormEvent) => {
    e.preventDefault();
    setRenaming(false);
    if (name.trim() && name.trim() !== column.name) actions?.renameColumn(column.id, name.trim());
  };
  const submitCard = (e: FormEvent) => {
    e.preventDefault();
    if (adding.trim()) actions?.addCard(column.id, adding.trim());
    setAdding("");
  };

  return (
    <section
      ref={setNodeRef}
      aria-label={column.name}
      className={cx("flex w-72 shrink-0 flex-col rounded-xl bg-slate-100 p-3 transition", isOver && "ring-2 ring-indigo-300")}
    >
      <header className="group mb-2 flex items-center gap-2">
        {renaming ? (
          <form onSubmit={submitRename} className="flex-1">
            <input
              autoFocus
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onBlur={submitRename}
              aria-label="Nome da coluna"
              className="w-full rounded border border-indigo-300 px-2 py-1 text-sm"
            />
          </form>
        ) : (
          <h2 className="flex-1 truncate text-sm font-semibold text-slate-700">{column.name}</h2>
        )}
        <span className="text-xs text-slate-400">{column.cards.length}</span>
        {!readOnly && actions && !renaming && (
          <span className="flex gap-0.5 opacity-60 transition group-hover:opacity-100">
            <button onClick={() => { setName(column.name); setRenaming(true); }} aria-label={`Renomear ${column.name}`} className="rounded p-1 text-slate-500 hover:bg-slate-200">
              <Pencil size={13} />
            </button>
            <button onClick={() => actions.deleteColumn(column)} aria-label={`Apagar ${column.name}`} className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-rose-600">
              <Trash2 size={13} />
            </button>
          </span>
        )}
      </header>
      <SortableContext items={column.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex min-h-8 flex-col gap-2">{children}</ul>
      </SortableContext>
      {!readOnly && actions && (
        <form onSubmit={submitCard} className="mt-2">
          <input
            value={adding}
            maxLength={120}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="+ Adicionar cartão"
            aria-label={`Novo cartão em ${column.name}`}
            className="w-full rounded-lg bg-transparent px-2 py-1.5 text-sm placeholder:text-slate-500 hover:bg-slate-200 focus:bg-white focus:outline-indigo-400"
          />
        </form>
      )}
    </section>
  );
}

function SortableCard(props: { card: CardDto; disabled?: boolean; assignee?: Member; editor?: Member; onOpen?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.card.id, disabled: props.disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
      onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" && props.onOpen) props.onOpen();
        else listeners?.onKeyDown?.(e);
      }}
      aria-label={props.card.title}
    >
      <CardFace card={props.card} assignee={props.assignee} editor={props.editor} interactive={!props.disabled} />
    </li>
  );
}

function CardFace({ card, assignee, editor, lifted, interactive }: { card: CardDto; assignee?: Member; editor?: Member; lifted?: boolean; interactive?: boolean }) {
  const overdue = isOverdue(card.dueDate);
  return (
    <div
      className={cx(
        "rounded-lg border bg-white p-3 shadow-sm",
        editor ? "border-indigo-400" : "border-slate-200",
        interactive && "cursor-grab hover:border-indigo-300",
        lifted && "rotate-2 cursor-grabbing shadow-lg",
      )}
    >
      {card.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <LabelChip key={l} label={l} />
          ))}
        </div>
      )}
      <p className="text-sm text-slate-800">{card.title}</p>
      {(card.dueDate || assignee) && (
        <div className="mt-2 flex items-center justify-between">
          {card.dueDate ? (
            <span className={cx("inline-flex items-center gap-1 text-xs", overdue ? "font-medium text-rose-600" : "text-slate-500")}>
              <CalendarDays size={12} /> {fmtDate(card.dueDate)}
              {overdue && " · atrasado"}
            </span>
          ) : (
            <span />
          )}
          {assignee && <Avatar id={assignee.id} name={assignee.name} size={22} />}
        </div>
      )}
      {editor && <p className="mt-2 text-xs text-indigo-600">{editor.name} está editando…</p>}
    </div>
  );
}

function AddColumn({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onAdd(name.trim());
        setName("");
      }}
      className="flex w-72 shrink-0 items-center gap-2 rounded-xl border border-dashed border-slate-300 p-3"
    >
      <Plus size={16} className="text-slate-400" />
      <input
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nova coluna"
        aria-label="Nova coluna"
        className="flex-1 bg-transparent text-sm focus:outline-none"
      />
    </form>
  );
}
