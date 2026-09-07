import Link from "next/link";
import { SearchBox } from "./SearchBox";

export function TopBar({ query = "" }: { query?: string }) {
  return (
    <header className="flex h-[72px] items-center justify-between border-b border-border px-14">
      {/* Keyed so a new query (e.g. Clear search) resets the box without a state-sync effect. */}
      <SearchBox key={query} query={query} />
      <Link href="/add" className="flex h-[34px] items-center gap-2 rounded-md bg-accent px-4 text-row font-semibold text-white hover:bg-accent/90">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
        Add documents
      </Link>
    </header>
  );
}
