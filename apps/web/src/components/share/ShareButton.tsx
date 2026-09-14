"use client";

import { useShareBasket } from "./ShareBasket";

/**
 * The add affordance on a document row, an item's records table and a search result (§10.5).
 *
 * Icon only, at the weight of the row it sits in. It began as a pill with an uppercase label,
 * which shouted across a table whose other columns are 13px muted text — an action nobody is
 * looking for while scanning a list should not be the loudest thing in the row. One control with
 * two states, because "add" and "remove" as separate buttons would mean deciding which to draw
 * before knowing the answer.
 */
export function ShareButton({ id, title, compact = false }: { id: string; title: string; compact?: boolean }) {
  const basket = useShareBasket();
  const inBasket = basket.has(id);
  const label = inBasket ? `Remove ${title} from the share` : `Add ${title} to a share`;

  return (
    <button
      type="button"
      onClick={(e) => {
        // These sit inside links and table rows; adding to the basket must not navigate.
        e.preventDefault();
        e.stopPropagation();
        basket.toggle({ id, title });
      }}
      aria-pressed={inBasket}
      aria-label={label}
      title={inBasket ? "In the share basket" : "Add to a share"}
      className={`inline-flex shrink-0 items-center justify-center rounded-md transition-colors ${
        compact ? "size-6" : "size-7"
      } ${inBasket ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface hover:text-text"}`}
    >
      {inBasket ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="size-[15px]" aria-hidden="true">
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      ) : (
        /* An outbound tray: the same mark the sidebar's Shared item uses, so the two read as one idea. */
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-[15px]" aria-hidden="true">
          <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M12 3v12M8 7l4-4 4 4" />
        </svg>
      )}
    </button>
  );
}
