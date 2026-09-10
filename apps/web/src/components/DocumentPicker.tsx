"use client";

import { useEffect, useRef, useState } from "react";
import type { RecentDocument, SearchResponse } from "@harbor/shared";
import { api } from "@/lib/api-client";

interface Choice {
  id: string;
  title: string;
  categoryPath: string | null;
}

/**
 * Pick the document a to-do belongs to.
 *
 * A vault holds hundreds of documents, so this is a search box rather than a select — it runs the
 * same ranked `tsv` search the Library uses, aliases and all, so "birth certificate" still finds
 * the Abstammungsurkunde. With nothing typed it offers what you opened recently instead of
 * nothing: the document you want a reminder about is usually the one you were just reading.
 */
export function DocumentPicker({
  value,
  onChange,
  placeholder = "Search for the document…",
}: {
  value: Choice | null;
  onChange: (choice: Choice | null) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<Choice[]>([]);
  /**
   * Results carry the query they answered. Whether a search is in flight is then derived rather
   * than stored, which keeps the effect free of synchronous setState — and means results for
   * "sta" can never be shown under "stadtwerke" while the newer request is still out.
   */
  const [hits, setHits] = useState<{ q: string; rows: Choice[] }>({ q: "", rows: [] });
  const box = useRef<HTMLDivElement>(null);
  const q = query.trim();
  const searched = hits.q === q;

  useEffect(() => {
    let cancelled = false;
    api<RecentDocument[]>("/documents/recent")
      .then((rows) => {
        if (!cancelled) setRecent(rows.map((r) => ({ id: r.documentId, title: r.title, categoryPath: r.categoryPath })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced. A reply that arrives after the query moved on is stamped with its own query and
  // simply never matches, so it cannot overwrite what is on screen.
  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<SearchResponse>(`/search?q=${encodeURIComponent(q)}&limit=8`)
        .then((res) => {
          if (!cancelled) setHits({ q, rows: res.hits.map((h) => ({ id: h.documentId, title: h.title, categoryPath: h.categoryPath })) });
        })
        .catch(() => {
          if (!cancelled) setHits({ q, rows: [] });
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function choose(c: Choice) {
    onChange(c);
    setQuery("");
    setOpen(false);
  }

  if (value) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-border-strong px-2.5 py-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" className="shrink-0 text-muted">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-row">{value.title}</span>
        <button type="button" onClick={() => onChange(null)} aria-label="Detach the document" className="shrink-0 text-muted hover:text-danger">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    );
  }

  const searching = q.length >= 2 && !searched;
  const list = q.length >= 2 ? (searched ? hits.rows : []) : recent;
  const heading = q.length >= 2 ? (searching ? "Searching…" : list.length ? "Matches" : "Nothing matched") : "Opened recently";

  return (
    <div ref={box} className="relative min-w-0">
      <input
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border-strong px-3 text-row outline-none focus:border-accent"
      />
      {open && (
        <div className="absolute left-0 top-10 z-20 max-h-72 w-[380px] overflow-y-auto rounded-md border border-border bg-ground p-1 shadow-lg">
          <div className="label px-2.5 py-1.5">{heading}</div>
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => choose(c)}
              className="flex w-full flex-col items-start gap-0.5 rounded px-2.5 py-1.5 text-left hover:bg-surface"
            >
              <span className="w-full truncate text-row">{c.title}</span>
              <span className="w-full truncate text-small text-muted">{c.categoryPath ?? "Inbox"}</span>
            </button>
          ))}
          {list.length === 0 && !searching && (
            <p className="px-2.5 py-2 text-small text-muted">
              {q.length >= 2 ? "No document matched. It may still be processing." : "Nothing opened yet — type to search."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
