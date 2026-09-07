"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ITEM_KIND_LABEL, type Item } from "@harbor/shared";
import { api } from "@/lib/api-client";

/**
 * Deleting an item removes the label and its links, never a document. The confirmation states
 * both counts because there is no undo — unlike a document, which waits in Recently deleted.
 */
export function DeleteItem({ item, documentCount, childCount }: { item: Item; documentCount: number; childCount: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api(`/items/${item.id}`, { method: "DELETE" });
      router.push("/items");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-small font-medium text-muted hover:text-danger">
        Delete {ITEM_KIND_LABEL[item.kind].one.toLowerCase()}
      </button>
    );
  }

  return (
    <div className="flex max-w-[520px] flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <p className="text-row font-semibold">Delete {item.label}?</p>
      <p className="text-small text-muted">{consequences(documentCount, childCount)}</p>
      {error && <p className="text-small text-danger">{error}</p>}
      <div className="flex items-center gap-4">
        <button type="button" onClick={remove} disabled={busy} className="h-9 rounded-md bg-danger px-4 text-row font-semibold text-white disabled:opacity-60">
          {busy ? "Deleting…" : "Yes, delete"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-row font-medium text-muted">
          Keep it
        </button>
      </div>
    </div>
  );
}

function consequences(documents: number, children: number): string {
  const parts = [
    documents > 0
      ? `${documents} document${documents === 1 ? "" : "s"} will stay in the vault, no longer marked as being about it`
      : "Nothing is filed against it",
    children > 0 ? `${children} thing${children === 1 ? "" : "s"} inside it will move to the top level` : null,
  ].filter(Boolean);
  return `${parts.join(". ")}. This can't be undone.`;
}
