"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Category } from "@harbor/shared";
import { api } from "@/lib/api-client";

/** Rename, reorder and remove, plus adding a subcategory. Two levels is the whole model (spec §1). */
export function CategoryTree({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tops = categories.filter((c) => c.parentId === null);
  const kids = (id: string) => categories.filter((c) => c.parentId === id);
  const countWithChildren = (c: Category) => c.documentCount + kids(c.id).reduce((n, k) => n + k.documentCount, 0);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const rename = (c: Category, name: string) =>
    act(c.id, () => api(`/categories/${c.id}`, { method: "PATCH", body: JSON.stringify({ name }) }));

  const remove = (c: Category) => act(c.id, () => api(`/categories/${c.id}`, { method: "DELETE" }));

  /** Swap with the sibling above or below and send the whole sibling order. */
  const move = (c: Category, delta: -1 | 1) => {
    const siblings = c.parentId === null ? tops : kids(c.parentId);
    const i = siblings.findIndex((s) => s.id === c.id);
    const j = i + delta;
    if (j < 0 || j >= siblings.length) return;
    const ids = siblings.map((s) => s.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    return act(c.id, () => api("/categories/reorder", { method: "POST", body: JSON.stringify({ ids }) }));
  };

  const addChild = (parent: Category, name: string) =>
    act(parent.id, () => api("/categories", { method: "POST", body: JSON.stringify({ name, parentId: parent.id }) }));

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="rounded-md bg-warn-soft px-3 py-2 text-row text-warn">{error}</p>}

      {tops.map((c, i) => (
        <div key={c.id} className="rounded-lg border border-border">
          <Row
            category={c}
            count={countWithChildren(c)}
            busy={busy === c.id}
            canMoveUp={i > 0}
            canMoveDown={i < tops.length - 1}
            onRename={(name) => rename(c, name)}
            onMove={(d) => move(c, d)}
            onRemove={() => remove(c)}
            onAddChild={(name) => addChild(c, name)}
          />
          {kids(c.id).length > 0 && (
            <div className="border-t border-border pl-8">
              {kids(c.id).map((k, ki) => (
                <Row
                  key={k.id}
                  category={k}
                  count={k.documentCount}
                  busy={busy === k.id}
                  canMoveUp={ki > 0}
                  canMoveDown={ki < kids(c.id).length - 1}
                  nested
                  onRename={(name) => rename(k, name)}
                  onMove={(d) => move(k, d)}
                  onRemove={() => remove(k)}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      <NewTopLevel onAdd={(name) => act("new", () => api("/categories", { method: "POST", body: JSON.stringify({ name }) }))} />
    </div>
  );
}

function Row({
  category,
  count,
  busy,
  canMoveUp,
  canMoveDown,
  nested = false,
  onRename,
  onMove,
  onRemove,
  onAddChild,
}: {
  category: Category;
  count: number;
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  nested?: boolean;
  onRename: (name: string) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onAddChild?: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [adding, setAdding] = useState(false);
  const [childName, setChildName] = useState("");
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={`flex flex-col gap-2 px-4 py-3 ${nested ? "border-b border-border last:border-b-0" : ""}`}>
      <div className="flex items-center gap-3">
        <div className="flex w-8 shrink-0 flex-col">
          <button type="button" disabled={!canMoveUp || busy} onClick={() => onMove(-1)} aria-label="Move up" className="text-label leading-none text-muted disabled:opacity-25 hover:text-text">
            ▲
          </button>
          <button type="button" disabled={!canMoveDown || busy} onClick={() => onMove(1)} aria-label="Move down" className="text-label leading-none text-muted disabled:opacity-25 hover:text-text">
            ▼
          </button>
        </div>

        {editing ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && name.trim() !== category.name) onRename(name.trim());
              setEditing(false);
            }}
          >
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-8 flex-1 rounded-md border border-border-strong px-2 text-row" />
            <button type="submit" className="text-small font-semibold text-accent">
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setName(category.name);
                setEditing(false);
              }}
              className="text-small text-muted"
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <span className={`flex-1 truncate ${nested ? "text-row" : "text-row font-semibold"}`}>{category.name}</span>
            <span className="shrink-0 text-small text-muted">{count === 0 ? "empty" : `${count} document${count === 1 ? "" : "s"}`}</span>
            <button type="button" disabled={busy} onClick={() => setEditing(true)} className="shrink-0 text-small font-medium text-accent">
              Rename
            </button>
            {onAddChild && (
              <button type="button" disabled={busy} onClick={() => setAdding(true)} className="shrink-0 text-small font-medium text-accent">
                Add sub
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="shrink-0 text-small text-muted hover:text-danger">
              Remove
            </button>
          </>
        )}
      </div>

      {confirming && (
        <div className="ml-11 flex items-center gap-3 text-small">
          <span className="text-muted">Remove {category.name}?</span>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              onRemove();
            }}
            className="font-semibold text-danger"
          >
            Yes, remove
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="text-muted">
            Keep
          </button>
        </div>
      )}

      {adding && onAddChild && (
        <form
          className="ml-11 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (childName.trim()) onAddChild(childName.trim());
            setChildName("");
            setAdding(false);
          }}
        >
          <input autoFocus value={childName} onChange={(e) => setChildName(e.target.value)} maxLength={60} placeholder={`A subcategory of ${category.name}`} className="h-8 w-64 rounded-md border border-border-strong px-2 text-small" />
          <button type="submit" className="text-small font-semibold text-accent">
            Add
          </button>
          <button type="button" onClick={() => setAdding(false)} className="text-small text-muted">
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}

function NewTopLevel({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start rounded-md border border-dashed border-border-strong px-4 py-2.5 text-row font-medium text-muted hover:text-text">
        + New category
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onAdd(name.trim());
        setName("");
        setOpen(false);
      }}
    >
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Pets, Boat, Grandparents…" className="h-9 w-64 rounded-md border border-border-strong px-3 text-row" />
      <button type="submit" className="h-9 rounded-md bg-accent px-4 text-row font-semibold text-white">
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-row font-medium text-muted">
        Cancel
      </button>
    </form>
  );
}
