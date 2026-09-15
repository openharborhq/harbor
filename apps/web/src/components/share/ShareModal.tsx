"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useState } from "react";
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
 * **A size that does not depend on its contents** — the window less a margin, the same frame the
 * document viewer uses. The form scrolls inside it. A dialog that grows as you fill it in moves
 * its own footer, and the button you were reaching for is somewhere else by the time you arrive.
 *
 * **One size, two panes.** The preview column is always there — it started out appearing only once
 * a document was picked, which meant the dialog resized under the pointer the first time anyone
 * clicked a row. A pane that is sometimes there is worse than one that is sometimes empty, so it
 * shows the first document by default and an empty frame when there is nothing to show.
 *
 * A Radix dialog, like the document viewer, so the app has one answer to what a dialog does rather
 * than two hand-rolled ones that drifted apart. It brings focus trapping, the page behind hidden
 * from screen readers, scroll locked without the layout shifting, focus returned on close — and
 * `data-state`, which is what keeps a closing dialog mounted long enough to animate out.
 */
export function ShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-40 bg-scrim/40" />
        {/* The same frame as the document viewer: two dialogs of different sizes read as two
            different kinds of thing, and these are both "something over the app". */}
        <Dialog.Content
          className="dialog-panel fixed inset-4 z-50 flex overflow-hidden rounded-card border border-border bg-ground shadow-[0_24px_64px_rgba(13,22,34,0.28)] outline-none lg:inset-8"
          aria-describedby={undefined}
        >
          {/* The form does not want to be wider than this however big the window is; the preview does. */}
          <div className="flex min-w-0 flex-1 flex-col sm:w-[560px] sm:shrink-0 sm:flex-none">
            <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
              <Dialog.Title className="flex-1 text-section font-semibold tracking-snug">Share</Dialog.Title>
              <Dialog.Close
                aria-label="Close"
                className="-mr-2 flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-4" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </Dialog.Close>
            </header>

            <ReviewShare onClose={close} preview={preview} onPreview={setPicked} />
          </div>

          {/*
            Hidden below `sm`: a phone has no room to put a preview beside anything, and a panel
            that slid over the form would hide the share being built.
          */}
          <aside className="hidden min-w-0 flex-1 border-l border-border bg-surface sm:flex">
            {/* Keyed per document: the "no preview" state is about one file, not about the pane. */}
            <DocPreview key={preview?.id ?? "none"} document={preview} />
          </aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
