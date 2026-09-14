import Link from "next/link";
import { MenuButton } from "./NavDrawer";
import { SearchBox } from "./SearchBox";

export function TopBar({ query = "" }: { query?: string }) {
  return (
    <header className="flex h-[72px] items-center gap-3 border-b border-border px-4 lg:gap-4 lg:px-14">
      <MenuButton />
      {/* Keyed so a new query (e.g. Clear search) resets the box without a state-sync effect. */}
      <SearchBox key={query} query={query} />
      <Link
        href="/add"
        aria-label="Add documents"
        className="ml-auto flex h-[34px] shrink-0 items-center gap-2 rounded-md bg-accent px-3 text-row font-semibold text-white hover:bg-accent/90 sm:px-4"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
        {/* On a phone the search box needs the width more than this label does. */}
        <span className="hidden sm:inline">Add documents</span>
      </Link>
    </header>
  );
}
