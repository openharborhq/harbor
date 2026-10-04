"use client";

import Link from "next/link";
import { useRef, useState } from "react";

/**
 * Library's own search field, for screens without the top-bar box (below lg, spec §4.2).
 *
 * A plain GET form to /library rather than a router push: it is the same URL the top bar builds,
 * it works before hydration, and submitting a new query drops whatever chip was selected for the
 * last one — `in` and `source` filter *these* results, not the next search's.
 *
 * Two ways out, because they mean different things. The × empties the field and keeps the
 * keyboard up, for a second try at the words; Cancel leaves search and goes back to browsing.
 */
export function LibrarySearchField({ query = "" }: { query?: string }) {
  const [value, setValue] = useState(query);
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-3">
      <form
        action="/library"
        role="search"
        className={`flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-lg border-[1.5px] bg-ground px-3.5 focus-within:border-accent ${query ? "border-accent" : "border-border-strong"}`}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className={`shrink-0 ${query ? "text-accent" : "text-muted"}`}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={ref}
          type="search"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search inside every document"
          className="min-w-0 flex-1 bg-transparent text-copy outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          autoComplete="off"
          enterKeyHint="search"
          aria-label="Search inside every document"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              ref.current?.focus();
            }}
            // The drawn circle is 18px; the button around it is the 44px a thumb needs.
            className="-mr-3 flex size-11 shrink-0 items-center justify-center text-white"
            aria-label="Clear the search field"
          >
            <span className="flex size-[18px] items-center justify-center rounded-pill bg-border-strong">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </span>
          </button>
        )}
      </form>
      {query && (
        <Link href="/library" className="flex h-11 shrink-0 items-center text-copy font-medium text-accent">
          Cancel
        </Link>
      )}
    </div>
  );
}
