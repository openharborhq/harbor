"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Item } from "@trustworthier/shared";
import { api } from "@/lib/api-client";

const MAX = 2000;

/**
 * Free text about the item itself — the meter number, who the landlord is, where the spare key
 * lives. Deliberately not a document: things worth remembering that never came as paperwork.
 */
export function ItemNotes({ item }: { item: Item }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const trimmed = draft.trim();
      await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ notes: trimmed || null }) });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setDraft(item.notes ?? "");
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-section font-bold tracking-snug">Notes</h2>
          <button type="button" onClick={() => setEditing(true)} className="text-small font-medium text-accent">
            {item.notes ? "Edit" : "Add a note"}
          </button>
        </div>
        {item.notes ? (
          <p className="max-w-[720px] whitespace-pre-wrap text-body">{item.notes}</p>
        ) : (
          <p className="text-body text-muted">Nothing yet — the meter number, the landlord, where the spare key lives.</p>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-section font-bold tracking-snug">Notes</h2>
      <textarea
        autoFocus
        rows={5}
        maxLength={MAX}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="The meter number, the landlord, where the spare key lives."
        className="max-w-[720px] rounded-md border border-border-strong bg-ground p-3 text-body placeholder:text-muted"
      />
      {error && <p className="text-small text-danger">{error}</p>}
      <div className="flex items-center gap-4">
        <button type="button" onClick={save} disabled={busy} className="h-9 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-60">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={cancel} className="text-row font-medium text-muted">
          Cancel
        </button>
        <span className="ml-auto text-small text-muted">
          {draft.length}/{MAX}
        </span>
      </div>
    </section>
  );
}
