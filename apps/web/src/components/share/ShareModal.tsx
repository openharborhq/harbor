"use client";

import { useEffect, useRef } from "react";
import { ReviewShare } from "./ReviewShare";

/**
 * The review screen, over whatever page the basket was filled from (spec §10.5).
 *
 * It was a page of its own, which was wrong for what it is: the basket is gathered *while*
 * working — a search, then an item, then the inbox — and sending someone to another screen to
 * finish loses the place they were in, for a step that is mostly confirmation. A layer over the
 * page keeps that context and makes cancelling free.
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
    // Focus moves in, so the first Tab lands inside the dialog rather than behind it.
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-text/40 p-4 sm:p-6 lg:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Review share"
      // Only a click that starts and ends on the backdrop closes it: a drag that began inside the
      // panel and ended outside used to discard a half-filled form.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="my-auto w-full max-w-[640px] rounded-card border border-border bg-ground shadow-[0_16px_48px_rgba(13,22,34,0.24)] outline-none"
      >
        <header className="flex items-start gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-section font-semibold tracking-snug">Review share</h2>
            <p className="mt-1 text-small text-muted">
              Sealed into one archive, encrypted under a key made for this share alone, and handed over only through the links
              you copy.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-4" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="px-6 py-5">
          <ReviewShare onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
