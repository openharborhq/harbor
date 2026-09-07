"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";

/**
 * Bulk-deletes everything on the "not paperwork" view. Soft delete, like every other delete here:
 * it goes to Deleted documents and comes back from there, which is what makes offering the button
 * at all reasonable.
 */
export function DeleteClutter({ ids }: { ids: string[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api<{ deleted: number }>("/documents/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) });
      router.refresh();
      router.push("/inbox");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!ids.length) return null;

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-small text-danger">{error}</span>}
      {confirming ? (
        <>
          <span className="text-row">Delete {ids.length}?</span>
          <button type="button" disabled={busy} onClick={run} className="h-10 rounded-md px-3 text-row font-semibold text-danger hover:underline underline-offset-2 disabled:opacity-60">
            {busy ? "Deleting…" : "Yes, delete them"}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="h-10 rounded-md border border-border bg-ground px-4 text-row font-medium">
            Cancel
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="h-10 rounded-md border border-border bg-ground px-4 text-row font-medium">
          Delete all {ids.length}
        </button>
      )}
    </div>
  );
}
