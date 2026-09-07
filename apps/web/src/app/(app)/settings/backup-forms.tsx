"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { BackupRunKind } from "@harbor/shared";
import { api } from "@/lib/api-client";

const primary = "h-9 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-60";
const secondary = "h-9 rounded-md border border-border bg-ground px-4 text-row font-medium disabled:opacity-60";

/**
 * "Back up now" and "Test a restore" (spec §3.4). Both only enqueue; the `backup` container does
 * the work and writes the row this page shows. While a run is in flight the page refreshes itself,
 * so the result appears without the owner reloading.
 */
export function BackupActions({ configured, running }: { configured: boolean; running: BackupRunKind | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<BackupRunKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(t);
  }, [running, router]);

  async function start(kind: BackupRunKind) {
    setBusy(kind);
    setError(null);
    try {
      await api("/backups/run", { method: "POST", body: JSON.stringify({ kind }) });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const disabled = !configured || running !== null || busy !== null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={primary} disabled={disabled} onClick={() => start("backup")}>
        {running === "backup" ? "Backing up…" : "Back up now"}
      </button>
      <button type="button" className={secondary} disabled={disabled} onClick={() => start("restore_test")}>
        {running === "restore_test" ? "Testing the restore…" : "Test a restore"}
      </button>
      {error && <span className="text-small text-danger">{error}</span>}
    </div>
  );
}
