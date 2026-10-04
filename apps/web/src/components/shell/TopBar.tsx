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

      No rule under it, by decision. The controls carry their own edges and the page's first
      heading sits far enough below to separate itself; a line across the full width made a band
      out of what is really just a row of controls.

      On a phone it is the menu and Add and nothing else (spec §4.2). Search lives in the pages
      that are about finding — Home and Library — as a field wide enough to type into, rather
      than squeezed between two buttons here.
    */
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-ground pr-4 pl-2.5 lg:h-[72px] lg:gap-4 lg:px-14">
      <MenuButton />
      {/* Keyed so a new query (e.g. Clear search) resets the box without a state-sync effect. */}
      <div className="hidden min-w-0 flex-1 lg:flex">
        <SearchBox key={query} query={query} />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2 lg:gap-3">
        <ShareTrigger />
        <Link
          href="/add"
          aria-label="Add documents"
          className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-accent-fill text-white hover:bg-accent-fill/90 lg:h-[34px] lg:w-auto lg:gap-2 lg:rounded-md lg:px-4 lg:text-row lg:font-semibold"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" className="lg:hidden">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="hidden lg:block">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          <span className="hidden lg:inline">Add documents</span>
        </Link>
      </div>
    </header>
  );
}
