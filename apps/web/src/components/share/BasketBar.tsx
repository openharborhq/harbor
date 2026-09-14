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
    /*
      Centred on the content, not the window: the sidebar owns the first 248px from `lg` up, and a
      bar centred on the viewport sits visibly left of the column it belongs to. Below `lg` the
      sidebar is off-canvas and the content is the whole width.
    */
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-5 lg:left-sidebar">
      <div className="pointer-events-auto flex items-center gap-4 rounded-card border border-border-strong bg-ground py-2.5 pl-5 pr-2.5 shadow-[0_8px_24px_rgba(13,22,34,0.12)]">
        {/*
          A count, not a list of titles. The titles are already on the page the basket was filled
          from, and the review screen shows every one of them with a way to take it out — repeating
          them here made a bar that grew with its contents and truncated exactly when it mattered.
        */}
        <span className="text-row font-semibold">
          {n} document{n === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={basket.clear}
          className="h-8 shrink-0 rounded-md px-2 text-row text-muted transition-colors hover:bg-surface hover:text-text"
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
