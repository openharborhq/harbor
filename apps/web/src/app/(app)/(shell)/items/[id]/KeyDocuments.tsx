"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { KeyDocumentSlot } from "@harbor/shared";
import { api } from "@/lib/api-client";
import { daysUntil, formatDate } from "@/lib/format";

/**
 * Key-document slots. A card carries what you came for — what it is, what it is called, when it
 * runs out — and nothing else until you reach for it: linking and removing appear on hover, on
 * focus for the keyboard, and always on a screen with no pointer to hover with.
 */
const REVEAL = "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

export function KeyDocuments({ itemId, slots, candidates }: { itemId: string; slots: KeyDocumentSlot[]; candidates: { id: string; title: string }[] }) {
  const router = useRouter();
  const [linking, setLinking] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState("");

  async function link(slot: KeyDocumentSlot, documentId: string | null) {
    await api(`/items/${itemId}/key-documents/${slot.id}`, { method: "PATCH", body: JSON.stringify({ kind: slot.kind, documentId }) });
    setLinking(null);
    router.refresh();
  }
  async function addSlot(e: React.FormEvent) {
    e.preventDefault();
    if (!newKind.trim()) return;
    await api(`/items/${itemId}/key-documents`, { method: "POST", body: JSON.stringify({ kind: newKind.trim() }) });
    setNewKind("");
    setAdding(false);
    router.refresh();
  }
  async function removeSlot(slot: KeyDocumentSlot) {
    await api(`/items/${itemId}/key-documents/${slot.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="grid grid-cols-5 gap-4">
      {slots.map((s) => {
        const days = s.document?.expiresAt ? daysUntil(s.document.expiresAt) : null;
        if (s.document) {
          // A date earns its line only when it says something: an expiry, or the date on the paper.
          const when = s.document.expiresAt ? (days! <= 0 ? "Expired" : `Expires ${formatDate(s.document.expiresAt)}`) : s.document.documentDate ? formatDate(s.document.documentDate) : null;
          return (
            <div key={s.id} className="group flex min-h-[116px] flex-col rounded-lg border border-border p-4 transition-colors hover:border-border-strong">
              <div className="label">{s.kind}</div>
              <Link href={`/documents/${s.document.id}`} className="mt-1.5 line-clamp-2 text-row font-semibold hover:text-accent">
                {s.document.title}
              </Link>
              <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                <span className={`text-small ${days !== null && days <= 90 ? "font-medium text-warn" : "text-muted"}`}>{when}</span>
                <button type="button" onClick={() => link(s, null)} className={`shrink-0 text-small text-muted hover:text-text ${REVEAL}`}>
                  Unlink
                </button>
              </div>
            </div>
          );
        }
        if (linking === s.id) {
          return (
            <div key={s.id} className="flex min-h-[116px] flex-col rounded-lg border border-border p-4">
              <div className="label">{s.kind}</div>
              <select autoFocus onChange={(e) => e.target.value && link(s, e.target.value)} onBlur={() => setLinking(null)} defaultValue="" className="mt-auto h-8 w-full rounded-md border border-border bg-ground px-2 text-small">
                <option value="">Choose a document…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
          );
        }
        // Empty: the dashed edge and the missing title already say "not on file". The whole card is
        // the target, so the visible "Link" is a label over it rather than a second button.
        return (
          <div key={s.id} className="group relative flex min-h-[116px] flex-col rounded-lg border border-dashed border-border transition-colors hover:border-border-strong">
            <button type="button" onClick={() => setLinking(s.id)} className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <span className="sr-only">Link a document as {s.kind}</span>
            </button>
            <div className="p-4 pb-0">
              <div className="label">{s.kind}</div>
            </div>
            <div className={`pointer-events-none relative mt-auto flex items-end justify-between gap-2 p-4 ${REVEAL}`}>
              <span className="text-small font-medium text-accent">Link</span>
              <button type="button" onClick={() => removeSlot(s)} className="pointer-events-auto shrink-0 text-small text-muted hover:text-text">
                Remove
              </button>
            </div>
          </div>
        );
      })}
      {adding ? (
        <form onSubmit={addSlot} className="flex min-h-[116px] flex-col gap-2 rounded-lg border border-border p-4">
          <input autoFocus value={newKind} onChange={(e) => setNewKind(e.target.value)} placeholder="e.g. Residence permit" className="h-8 rounded-md border border-border-strong px-2 text-small" />
          <div className="mt-auto flex gap-3">
            <button type="submit" className="text-small font-semibold text-accent">
              Add
            </button>
            <button type="button" onClick={() => setAdding(false)} className="text-small text-muted">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="flex min-h-[116px] items-center justify-center rounded-lg text-small font-medium text-muted transition-colors hover:bg-surface hover:text-text">
          + Add a slot
        </button>
      )}
    </div>
  );
}
