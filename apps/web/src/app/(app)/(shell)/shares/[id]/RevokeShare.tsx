"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";

/**
 * Withdrawing a share (spec §10.2). Confirmed rather than immediate, because it destroys the
 * archive and its key together and cannot be undone — the documents are still in the vault, but
 * this particular parcel stops existing.
 */
export function RevokeShare({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await api(`/shares/${id}/revoke`, { method: "POST" });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="h-9 rounded-md border border-border bg-ground px-4 text-row font-semibold text-danger hover:bg-surface"
        >
          Withdraw this share
        </button>
        <span className="text-small text-muted">The links stop working immediately.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-ground p-4">
      <p className="max-w-[62ch] text-body">
        This destroys the sealed archive and its key. Every link stops working at once — but anything a recipient has
        already downloaded stays with them.
      </p>
      {error && <p className="text-small text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void revoke()}
          className="h-9 rounded-md bg-danger px-4 text-row font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Withdrawing…" : "Withdraw"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="h-9 rounded-md px-3 text-row text-muted hover:text-text">
          Keep it
        </button>
      </div>
    </div>
  );
}
