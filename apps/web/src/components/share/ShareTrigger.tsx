"use client";

import { useState } from "react";
import { useShareBasket } from "./ShareBasket";
import { ShareModal } from "./ShareModal";

/**
 * The share action, in the top bar, counting what is ticked (spec §10.5).
 *
 * It replaced a bar that floated over the bottom of the page. A count belongs beside the thing it
 * counts and stays where it was last seen; a floating bar covered the last row of every list and
 * appeared in a place nothing else in the app uses. The header is static, so this does not move
 * as the list scrolls.
 *
 * Absent until something is ticked: an empty control that says "0 documents" is a control asking
 * to be explained.
 */
export function ShareTrigger() {
  const basket = useShareBasket();
  const [open, setOpen] = useState(false);
  const n = basket.documents.length;

  // The modal outlives the selection: creating a share empties it, and the links it just minted
  // are on screen and readable only then.
  if (!basket.ready || (n === 0 && !open)) return null;

  return (
    <>
      {n > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-[34px] shrink-0 items-center gap-2 rounded-md border border-border-strong bg-ground px-3 text-row font-semibold transition-colors hover:bg-surface"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-muted" aria-hidden="true">
            <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M12 3v12M8 7l4-4 4 4" />
          </svg>
          <span className="hidden sm:inline">Share</span>
          {/*
            10px, a step below the locked scale's smallest label. A count inside a button is read
            as a quantity rather than as text, and at 11px it competed with the word beside it.
          */}
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-accent px-1.5 text-[10px] font-bold leading-none tabular-nums text-white">
            {n}
          </span>
        </button>
      )}
      <ShareModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
