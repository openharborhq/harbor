"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ITEM_DETAIL_FIELDS, ITEM_KIND_LABEL, NESTABLE_ITEM_KINDS, type Item, type ItemKind } from "@harbor/shared";
import { api } from "@/lib/api-client";

const NESTABLE = new Set<string>(NESTABLE_ITEM_KINDS);

/** The dashed "add" tile at the end of each kind's grid, and the form it opens. */
export function ItemForm({ kind, parents }: { kind: ItemKind; parents: Item[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [details, setDetails] = useState<Record<string, string>>({});
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = ITEM_DETAIL_FIELDS[kind];
  const canNest = NESTABLE.has(kind) && parents.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(details).filter(([, v]) => v.trim() !== ""));
      await api("/items", { method: "POST", body: JSON.stringify({ kind, label, details: clean, parentId: parentId || null }) });
      setLabel("");
      setDetails({});
      setParentId("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border-strong text-row font-medium text-muted hover:text-text">
        <span className="text-[22px] leading-none">+</span>
        Add {ITEM_KIND_LABEL[kind].one.toLowerCase()}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-card border border-border p-5">
      <label className="flex flex-col gap-1.5">
        <span className="label">Name</span>
        <input required autoFocus value={label} onChange={(e) => setLabel(e.target.value)} className="h-10 rounded-md border border-border-strong px-3 text-row" placeholder={placeholderFor(kind)} />
      </label>
      {fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1.5">
          <span className="label">{f.label}</span>
          <input
            type={f.type}
            value={details[f.key] ?? ""}
            onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.value }))}
            placeholder={f.placeholder}
            className="h-10 rounded-md border border-border px-3 text-row"
          />
        </label>
      ))}
      {canNest && (
        <label className="flex flex-col gap-1.5">
          <span className="label">Inside</span>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="h-10 rounded-md border border-border bg-ground px-2 text-row">
            <option value="">Nothing — it stands on its own</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="text-small text-danger">{error}</p>}
      <div className="mt-1 flex items-center gap-3">
        <button type="submit" disabled={busy} className="h-9 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-60">
          {busy ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-row font-medium text-muted">
          Cancel
        </button>
      </div>
    </form>
  );
}

function placeholderFor(kind: ItemKind): string {
  switch (kind) {
    case "person":
      return "First name is enough";
    case "property":
      return "The Munich flat";
    case "vehicle":
      return "The Passat";
    case "account":
      return "Joint current account";
    default:
      return "Name";
  }
}
