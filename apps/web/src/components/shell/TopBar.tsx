import Link from "next/link";

export function TopBar({ query = "" }: { query?: string }) {
  return (
    <header className="flex h-[72px] items-center justify-between border-b border-border px-14">
      <form action="/library" className="flex h-[34px] w-[457px] items-center gap-2.5 rounded-md border border-border bg-ground px-3">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          name="q"
          defaultValue={query}
          placeholder="Search inside every document"
          className="min-w-0 flex-1 bg-transparent text-row outline-none placeholder:text-muted"
          autoComplete="off"
        />
        <kbd className="text-label text-muted">⌘K</kbd>
      </form>
      <Link href="/add" className="flex h-[34px] items-center gap-2 rounded-md bg-accent px-4 text-row font-semibold text-white hover:bg-accent/90">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
        Add documents
      </Link>
    </header>
  );
}
