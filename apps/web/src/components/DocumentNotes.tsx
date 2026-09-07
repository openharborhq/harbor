"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DocumentSummary } from "@trustworthier/shared";
import { api } from "@/lib/api-client";

const MAX = 5000;

/**
 * What the document itself doesn't say: why it was kept, what was agreed on the phone, which
 * invoice it settles. Editable in place rather than through "Edit details", so writing one is
 * never a detour through the whole form. Indexed at weight B, so a note can be searched for.
 */
export function DocumentNotes({ doc }: { doc: DocumentSummary }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(doc.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const trimmed = draft.trim();
      await api(`/documents/${doc.id}`, { method: "PATCH", body: JSON.stringify({ notes: trimmed || null }) });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setDraft(doc.notes ?? "");
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <section className="mt-5 flex flex-col gap-1.5">
        <div className="flex items-baseline gap-3">
          <span className="label">Notes</span>
          <button type="button" onClick={() => setEditing(true)} className="text-small font-medium text-accent">
            {doc.notes ? "Edit" : "Add a note"}
          </button>
        </div>
        {doc.notes ? (
          <p className="whitespace-pre-wrap text-row">{doc.notes}</p>
        ) : (
          <p className="text-small text-muted">Nothing yet — why you kept it, what was agreed, what it settles.</p>
        )}
      </section>
    );
  }

  return (
    <section className="mt-5 flex flex-col gap-1.5">
      <span className="label">Notes</span>
      <textarea
        autoFocus
        rows={4}
        maxLength={MAX}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Why you kept it, what was agreed, what it settles."
        className="w-full rounded-md border border-border-strong bg-ground p-3 text-row placeholder:text-muted"
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
