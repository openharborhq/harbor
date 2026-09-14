import Link from "next/link";
import { MenuButton } from "./NavDrawer";
import { SearchBox } from "./SearchBox";
import { ShareTrigger } from "@/components/share/ShareTrigger";

export function TopBar({ query = "" }: { query?: string }) {
  return (
    /*
      Static, with the page flowing under it: search and the share count have to stay reachable
      halfway down a list of two hundred documents. `bg-ground` is load-bearing — a transparent
      sticky header shows the rows sliding through it.
    */
    <header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-border bg-ground px-4 lg:gap-4 lg:px-14">
      <MenuButton />
      {/* Keyed so a new query (e.g. Clear search) resets the box without a state-sync effect. */}
      <SearchBox key={query} query={query} />
      <div className="ml-auto flex shrink-0 items-center gap-2 lg:gap-3">
      <ShareTrigger />
      <Link
        href="/add"
        aria-label="Add documents"
        className="flex h-[34px] shrink-0 items-center gap-2 rounded-md bg-accent px-3 text-row font-semibold text-white hover:bg-accent/90 sm:px-4"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
        {/* On a phone the search box needs the width more than this label does. */}
        <span className="hidden sm:inline">Add documents</span>
      </Link>
      </div>
    </header>
  );
}
