"use client";

import { useEffect, useRef } from "react";
import { ReviewShare } from "./ReviewShare";

/**
 * The review step, over whatever page the basket was filled from (spec §10.5).
 *
 * It was a page of its own, which was wrong for what it is: the basket is gathered *while*
 * working — a search, then an item, then the inbox — and sending someone to another screen to
 * finish loses the place they were in, for a step that is mostly confirmation.
 *
 * The shell is three bands, not one scrolling column: a header that names the step, a body that
 * scrolls, and a footer that does not. The action has to stay on screen — a dialog whose only
 * button is below the fold reads as a form with no way to finish it.
 */
export function ShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-text/40 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      // Only a press that begins on the backdrop closes it: a drag that started inside the panel
      // and ended outside used to discard a half-filled form.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-[560px] flex-col rounded-t-card bg-ground shadow-[0_16px_48px_rgba(13,22,34,0.24)] outline-none sm:max-h-[85vh] sm:rounded-card"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
          <h2 id="share-modal-title" className="flex-1 text-section font-semibold tracking-snug">
            Review share
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-4" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <ReviewShare onClose={onClose} />
      </div>
    </div>
  );
}
