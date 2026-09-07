"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Top-bar search. Client-side navigation so only the results area changes, never the shell. */
export function SearchBox({ query = "" }: { query?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const ref = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K focuses the box, as the design promises.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    router.push(q ? `/library?q=${encodeURIComponent(q)}` : "/library");
  }

  return (
    <form onSubmit={submit} className="flex h-[34px] w-[457px] items-center gap-2.5 rounded-md border border-border bg-ground px-3 focus-within:border-accent">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search inside every document"
        className="min-w-0 flex-1 bg-transparent text-row outline-none placeholder:text-muted"
        autoComplete="off"
        aria-label="Search inside every document"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            setValue("");
            router.push("/library");
          }}
          className="text-label text-muted hover:text-text"
          aria-label="Clear search"
        >
          ✕
        </button>
      ) : (
        <kbd className="text-label text-muted">⌘K</kbd>
      )}
    </form>
  );
}
