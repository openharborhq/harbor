"use client";

import { useShareBasket } from "./ShareBasket";

/**
 * The add affordance that sits on a document row, an item's records table and a search result
 * (spec §10.5). One control, two states — in the basket or not — because "add" and "remove" as
 * separate buttons would mean deciding which to show before knowing the answer.
 */
export function ShareButton({ id, title, compact = false }: { id: string; title: string; compact?: boolean }) {
  const basket = useShareBasket();
  const inBasket = basket.has(id);

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
      title={inBasket ? "In the share basket" : "Add to a share"}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill border text-label font-bold uppercase tracking-label transition-colors ${
        compact ? "h-6 px-2" : "h-7 px-2.5"
      } ${
        inBasket
          ? "border-accent bg-accent-soft text-accent"
          : "border-border bg-ground text-muted hover:border-border-strong hover:text-text"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-3.5">
        {inBasket ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : <path d="M12 5v14M5 12h14" />}
      </svg>
      {inBasket ? "Added" : "Share"}
    </button>
  );
}
