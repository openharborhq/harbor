"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ITEM_KIND_LABEL, type Item } from "@trustworthier/shared";
import { api } from "@/lib/api-client";

/**
 * Where this item sits: inside another thing, or on its own. Editable, because nesting is a
 * guess you make early — "is the boat part of the holiday house?" — and the answer changes.
 */
export function ItemParent({ item, candidates }: { item: Item; candidates: Item[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState(item.parentId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(parentId: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ parentId: parentId || null }) });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (item.kind === "person") return null;

  if (!editing) {
    return (
      <p className="mt-1.5 flex items-center gap-2 text-small text-muted">
        {item.parentLabel ? `Inside ${item.parentLabel}` : "Stands on its own"}
        <button type="button" onClick={() => setEditing(true)} className="font-medium text-accent">
          Change
        </button>
      </p>
    );
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <select
          autoFocus
          value={choice}
          disabled={busy}
          onChange={(e) => {
            setChoice(e.target.value);
            void save(e.target.value);
          }}
          className="h-8 max-w-[320px] rounded-md border border-border-strong bg-ground px-2 text-small"
        >
          <option value="">Nothing — it stands on its own</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({ITEM_KIND_LABEL[c.kind].one.toLowerCase()})
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setEditing(false)} className="text-small font-medium text-muted">
          Cancel
        </button>
      </div>
      {error && <p className="max-w-[420px] text-small text-danger">{error}</p>}
    </div>
  );
}
