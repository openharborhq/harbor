"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Item } from "@harbor/shared";

/**
 * The things you do to an item rather than with it: rename it, take its photo off.
 *
 * They were loose in the header — "Edit" beside the name, "Remove" under the photo — which put a
 * destructive action at the same weight as the name itself, one stray click from happening. Edits
 * are rare next to reading the page they sit on, so they belong behind one control that has to be
 * opened on purpose.
 */
export function ItemMenu({ item, onEdit }: { item: Item; onEdit: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /** The menu has two faces: its items, and the question it asks before the destructive one. */
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      // Escape steps back one layer: out of the question first, then out of the menu.
      if (e.key !== "Escape") return;
      if (confirming) setConfirming(false);
      else close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, confirming]);

  function close() {
    setOpen(false);
    setConfirming(false);
  }

  async function removePhoto() {
    close();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${item.id}/avatar`, { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error(`Could not remove the photo (${res.status})`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${item.label}`}
        className="flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden="true">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open && !confirming && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-[200px] overflow-hidden rounded-lg border border-border bg-ground py-1 shadow-[0_8px_24px_rgba(13,22,34,0.14)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onEdit();
            }}
            className="flex w-full items-center px-3 py-2 text-left text-row transition-colors hover:bg-surface"
          >
            Edit name and details
          </button>
          {item.avatarUpdatedAt && (
            <button
              type="button"
              role="menuitem"
              onClick={() => setConfirming(true)}
              className="flex w-full items-center px-3 py-2 text-left text-row text-danger transition-colors hover:bg-surface"
            >
              Remove photo…
            </button>
          )}
        </div>
      )}

      {/*
        Asked in the menu's own place rather than over the page. It is a small, undoable-by-redoing
        act — the photo can be added again — so it wants a question, not a dialog that takes the
        screen. Keeping is the quiet default; removing has to be chosen twice.
      */}
      {open && confirming && (
        <div className="absolute right-0 top-full z-20 mt-1 w-[240px] rounded-lg border border-border bg-ground p-3 shadow-[0_8px_24px_rgba(13,22,34,0.14)]">
          <p className="text-row font-semibold">Remove the photo?</p>
          <p className="mt-1 text-small text-muted">{item.label} goes back to initials. You can add another later.</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void removePhoto()}
              className="h-8 rounded-md bg-danger px-3 text-row font-semibold text-white transition-opacity hover:opacity-90"
            >
              Remove
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="h-8 rounded-md px-2 text-row font-medium text-muted hover:text-text">
              Keep it
            </button>
          </div>
        </div>
      )}

      {error && <p className="absolute right-0 top-full mt-1 w-[240px] text-small text-danger">{error}</p>}
    </div>
  );
}
