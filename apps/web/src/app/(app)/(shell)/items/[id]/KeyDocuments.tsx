"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { KeyDocumentSlot } from "@harbor/shared";
import { api } from "@/lib/api-client";
import { daysUntil, formatDate } from "@/lib/format";

/** Key-document slots; an empty slot is the design's dashed "Not on file" card. */
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
        return (
          <div key={s.id} className={`flex min-h-[132px] flex-col gap-1 rounded-lg p-4 ${s.document ? "border border-border" : "border border-dashed border-border-strong"}`}>
            <div className="label">{s.kind}</div>
            {s.document ? (
              <>
                <Link href={`/documents/${s.document.id}`} className="mt-1 line-clamp-2 text-row font-semibold hover:text-accent">
                  {s.document.title}
                </Link>
                <div className={`mt-auto text-small ${days !== null && days <= 90 ? "font-medium text-warn" : "text-muted"}`}>
                  {s.document.expiresAt ? (days! <= 0 ? "Expired" : `Expires ${formatDate(s.document.expiresAt)}`) : s.document.documentDate ? formatDate(s.document.documentDate) : "On file"}
                </div>
                <button type="button" onClick={() => link(s, null)} className="text-left text-label text-muted hover:text-text">
                  Unlink
                </button>
              </>
            ) : linking === s.id ? (
              <select autoFocus onChange={(e) => e.target.value && link(s, e.target.value)} onBlur={() => setLinking(null)} defaultValue="" className="mt-1 h-8 w-full rounded-md border border-border bg-ground px-2 text-small">
                <option value="">Choose a document…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <div className="mt-1 text-row font-medium text-muted">Not on file</div>
                <div className="mt-auto flex items-center gap-3">
                  <button type="button" onClick={() => setLinking(s.id)} className="text-small font-medium text-accent">
                    Link
                  </button>
                  <button type="button" onClick={() => removeSlot(s)} className="text-small text-muted hover:text-text">
                    Remove
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
      {adding ? (
        <form onSubmit={addSlot} className="flex min-h-[132px] flex-col gap-2 rounded-lg border border-border p-4">
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
        <button type="button" onClick={() => setAdding(true)} className="flex min-h-[132px] items-center justify-center rounded-lg border border-dashed border-border-strong text-small font-medium text-muted hover:text-text">
          + Add a slot
        </button>
      )}
    </div>
  );
}
