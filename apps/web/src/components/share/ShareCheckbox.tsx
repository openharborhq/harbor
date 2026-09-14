"use client";

import { useShareBasket } from "./ShareBasket";

/**
 * Picking documents for a share, from any list they appear in (spec §10.5).
 *
 * A checkbox rather than a button, because what this does is **select**, and selection is a thing
 * lists have done since before the web: a tick is understood without a label, it says how many
 * are chosen at a glance down the column, and it costs the row no horizontal space. The earlier
 * per-row Share button had to answer "add or remove?" in its own label, which is a question a
 * checkbox does not have to ask.
 *
 * Where the count and the action live is the top bar — one place, not once per row.
 */
export function ShareCheckbox({ id, title }: { id: string; title: string }) {
  const basket = useShareBasket();
  const checked = basket.has(id);

  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={() => basket.toggle({ id, title })}
      // These sit inside rows that are links; ticking one must not navigate.
      onClick={(e) => e.stopPropagation()}
      aria-label={`Select ${title} to share`}
      className="size-4 shrink-0 cursor-pointer accent-accent"
    />
  );
}
