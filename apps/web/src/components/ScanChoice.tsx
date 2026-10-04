"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DocumentSummary } from "@harbor/shared";
import { api } from "@/lib/api-client";

/**
 * Scan or photo, for a photo that was turned into a scan (spec §2 stage 1b).
 *
 * A choice that sticks, not a peek: when a scan came out wrong — a sliver of table, a page found
 * crooked — the fix is to keep the photo for this document, and then the preview, Download, Full
 * size and any share all use it. Flipping back is the same tap.
 */
export function ScanChoice({ documentId, preferOriginal, variant }: { documentId: string; preferOriginal: boolean; variant: "header" | "sheet" }) {
  const router = useRouter();
  const [photo, setPhoto] = useState(preferOriginal);
  const [busy, setBusy] = useState(false);

  async function choose(next: boolean) {
    if (next === photo || busy) return;
    setPhoto(next);
    setBusy(true);
    try {
      await api<DocumentSummary>(`/documents/${documentId}`, { method: "PATCH", body: JSON.stringify({ preferOriginal: next }) });
      router.refresh();
    } catch {
      setPhoto(!next);
    } finally {
      setBusy(false);
    }
  }

  const sheet = variant === "sheet";
  const option = (label: string, value: boolean) => (
    <button
      type="button"
      role="radio"
      aria-checked={photo === value}
      onClick={() => choose(value)}
      className={`flex flex-1 items-center justify-center rounded-[5px] font-semibold transition-colors ${sheet ? "min-h-10 text-copy" : "px-3 text-row"} ${
        photo === value ? "bg-ground text-text shadow-[0_1px_2px_rgba(13,22,34,0.12)]" : "text-muted"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      role="radiogroup"
      aria-label="Show the scan or the photo as taken"
      className={`flex shrink-0 gap-0.5 rounded-md bg-surface p-[3px] ${sheet ? "basis-full" : "hidden h-9 lg:flex"}`}
    >
      {option("Scan", false)}
      {option("Photo", true)}
    </div>
  );
}
