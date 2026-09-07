"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AcceptAllResult } from "@trustworthier/shared";
import { api } from "@/lib/api-client";

export function AcceptAll({ eligible }: { eligible: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AcceptAllResult | null>(null);

  async function run() {
    setBusy(true);
    try {
      setResult(await api<AcceptAllResult>("/documents/accept-all", { method: "POST" }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <span className="text-small text-muted">
          Filed {result.accepted}{result.skipped ? ` · ${result.skipped} left for you` : ""}
        </span>
      )}
      <button
        type="button"
        onClick={run}
        disabled={busy || eligible === 0}
        title={eligible === 0 ? "Only high-confidence suggestions are filed in bulk" : undefined}
        className="h-10 rounded-md border border-border bg-ground px-4 text-row font-medium disabled:opacity-50"
      >
        {busy ? "Filing…" : `Accept all suggestions${eligible ? ` (${eligible})` : ""}`}
      </button>
    </div>
  );
}
