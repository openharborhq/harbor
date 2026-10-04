"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DocumentSettings } from "@harbor/shared";
import { api } from "@/lib/api-client";

/**
 * One switch, saved as it is flipped: there is nothing to fill in alongside it, so a Save button
 * would only be a second step to forget.
 */
export function DocumentsForm({ current }: { current: DocumentSettings }) {
  const router = useRouter();
  const [on, setOn] = useState(current.photosToScans);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip() {
    const next = !on;
    setOn(next);
    setBusy(true);
    setError(null);
    try {
      await api<DocumentSettings>("/settings/documents", { method: "PATCH", body: JSON.stringify({ photosToScans: next }) });
      router.refresh();
    } catch (err) {
      setOn(!next);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex max-w-[620px] flex-col gap-3">
      <label className="flex cursor-pointer items-start justify-between gap-5 rounded-md border border-border px-4 py-4 sm:px-5">
        <span className="flex flex-col gap-1">
          <span className="text-body font-semibold">Turn photos into scans</span>
          <span className="text-body text-muted">
            A photo of a letter is cropped to the page, flattened, straightened at its folds and whitened, so it reads and prints
            like a scan. The photo itself is always kept, one tap away on the document.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={busy}
          onClick={flip}
          className={`mt-0.5 flex h-7 w-12 shrink-0 items-center rounded-pill px-[3px] transition-colors disabled:opacity-60 ${on ? "justify-end bg-accent" : "justify-start bg-border-strong"}`}
        >
          <span className="size-[22px] rounded-pill bg-ground shadow-sm" />
        </button>
      </label>
      <p className="text-body text-muted">
        {on
          ? "Applies to photos uploaded from now on. Documents already in the vault stay as they are."
          : "Photos uploaded from now on are kept exactly as taken. Scans already made stay, and each document can still switch between scan and photo."}
      </p>
      {error && <p className="text-body text-danger">{error}</p>}
    </section>
  );
}
