"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DocPreview } from "./DocPreview";
import { ReviewShare } from "./ReviewShare";
import { useShareBasket, type BasketDocument } from "./ShareBasket";

/**
 * Sharing, over whatever page the documents were picked on (spec §10.5).
 *
 * It was a page of its own, which was wrong for what it is: documents are ticked *while* working —
 * a search, then an item, then the inbox — and sending someone to another screen to finish loses
 * the place they were in, for a step that is mostly confirmation.
 *
 * **A fixed size.** The panel is one height whatever it holds, and the form scrolls inside it. A
 * dialog that grows with its contents moves its own footer while you fill it in, and the button
 * you were reaching for is somewhere else by the time you get there.
 *
 * **One size, two panes.** The preview column is always there — it started out appearing only once
 * a document was picked, which meant the dialog resized under the pointer the first time anyone
 * clicked a row. A pane that is sometimes there is worse than one that is sometimes empty, so it
 * shows the first document by default and an empty frame when there is nothing to show.
 *
 * It renders through a portal, and that is not tidiness. The trigger lives in the top bar, which
 * is `sticky` with a `z-index` — and those two together make a stacking context, so a `z-50`
 * anywhere inside it is still trapped beneath the bar's own `z-20`. The sidebar at `z-40` then
 * painted straight over the backdrop, leaving the navigation bright beside a dimmed page. Out at
 * the document body, the dialog is above everything, which is what "modal" means.
 */
export function ShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const basket = useShareBasket();
  const [picked, setPicked] = useState<BasketDocument | null>(null);

  /**
   * Derived rather than stored, so it can never point at a document that has been taken out of the
   * share: whatever was picked if it is still here, otherwise the first one. An effect keeping a
   * selection in step with the list would have to run after every removal and would be wrong in
   * between.
   */
  const preview = (picked && basket.documents.find((d) => d.id === picked.id)) || basket.documents[0] || null;

  // Closing forgets the preview, so reopening starts on the form rather than on whatever was last
  // being looked at. Done here rather than in an effect on `open`: it is one event, not a state
  // two things have to agree about.
  const close = useCallback(() => {
    setPicked(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // `open` is false on the server, so the portal is only ever reached in the browser.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-text/40 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      // Only a press that begins on the backdrop closes it: a drag that started inside the panel
      // and ended outside used to discard a half-filled form.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="flex h-[640px] max-h-[92vh] w-full max-w-[940px] overflow-hidden rounded-t-card bg-ground shadow-[0_16px_48px_rgba(13,22,34,0.24)] outline-none sm:max-h-[86vh] sm:rounded-card"
      >
        <div className="flex min-w-0 flex-1 flex-col sm:w-[560px] sm:flex-none">
          <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
            <h2 id="share-modal-title" className="flex-1 text-section font-semibold tracking-snug">
              Share
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mr-2 flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-4" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          <ReviewShare onClose={close} preview={preview} onPreview={setPicked} />
        </div>

        {/*
          Hidden below `sm`: a phone has no room to put a preview beside anything, and a panel that
          slid over the form would hide the share being built.
        */}
        <aside className="hidden min-w-0 flex-1 border-l border-border bg-surface sm:flex">
          {/* Keyed per document: the "no preview" state is about one file, not about the pane. */}
          <DocPreview key={preview?.id ?? "none"} document={preview} />
        </aside>
      </div>
    </div>,
    document.body,
  );
}
