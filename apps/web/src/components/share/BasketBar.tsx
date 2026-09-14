"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShareBasket } from "./ShareBasket";

/**
 * What the basket looks like while it is filling (spec §10.5).
 *
 * A bar rather than a panel: it has to be visible from the inbox, a search and an item page
 * without taking the screen over, and it has to be obvious how to put something back. Hidden on
 * the review screen itself, where the same list is the page.
 */
export function BasketBar() {
  const basket = useShareBasket();
  const pathname = usePathname();

  if (!basket.ready || basket.documents.length === 0) return null;
  if (pathname.startsWith("/share/new")) return null;

  const n = basket.documents.length;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-5">
      <div className="pointer-events-auto flex max-w-[min(680px,100%)] items-center gap-3 rounded-card border border-border-strong bg-ground px-4 py-3 shadow-[0_8px_24px_rgba(13,22,34,0.12)]">
        <div className="min-w-0 flex-1">
          <div className="text-row font-semibold">
            {n} document{n === 1 ? "" : "s"} ready to share
          </div>
          <div className="truncate text-small text-muted">{basket.documents.map((d) => d.title).join(" · ")}</div>
        </div>
        <button
          type="button"
          onClick={basket.clear}
          className="h-8 shrink-0 rounded-md px-3 text-row text-muted transition-colors hover:bg-surface hover:text-text"
        >
          Clear
        </button>
        <Link
          href="/share/new"
          className="inline-flex h-8 shrink-0 items-center rounded-md bg-accent px-4 text-row font-semibold text-white transition-opacity hover:opacity-90"
        >
          Review share
        </Link>
      </div>
    </div>
  );
}
