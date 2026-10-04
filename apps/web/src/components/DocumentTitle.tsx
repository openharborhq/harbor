"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";

/**
 * The document's heading, editable in place.
 *
 * The name shown here is `displayTitle(doc)` — the same rule the Inbox card uses — so the card you
 * clicked and the page it opens can never disagree. That was the actual complaint: the Inbox said
 * "Spotify Premium Family Receipt" and the page said the filename.
 *
 * Editing writes to `documents.title`, which by that rule immediately takes precedence over any
 * suggestion, so a name you typed is never quietly replaced by the model's.
 */
export function DocumentTitle({ documentId, title }: { documentId: string; title: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  /**
   * What this render shows. The prop is the truth; `justSaved` only covers the gap between the
   * PATCH returning and the server component re-rendering with the new name.
   *
   * Deliberately not mirrored into state by an effect: copying props into state on every change
   * is the pattern that causes cascading renders, and it would also fight the parent whenever
   * something else renames the document — accepting a suggestion, for one.
   */
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const shown = justSaved ?? title;

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function startEditing() {
    setValue(shown);
    setError(null);
    setEditing(true);
  }

  async function save(next: string) {
    const trimmed = next.trim();
    if (!trimmed || trimmed === shown) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/documents/${documentId}`, { method: "PATCH", body: JSON.stringify({ title: trimmed }) });
      setJustSaved(trimmed);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      // Wraps on a phone, where it is the top of the sheet and has lines to spare; one truncated
      // line in the desktop header band, which has a fixed height.
      <div className="flex min-w-0 items-start gap-1 lg:mt-2 lg:items-center lg:gap-2">
        <h1 className="min-w-0 break-words text-lead font-bold tracking-snug lg:truncate lg:text-[24px] lg:leading-[30px]">{shown}</h1>
        <button
          type="button"
          onClick={startEditing}
          aria-label={`Rename ${shown}`}
          title="Rename"
          className="-my-2.5 flex size-11 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface hover:text-text lg:my-0 lg:size-auto lg:p-1"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
        {error && <span className="shrink-0 text-body text-danger lg:text-small">{error}</span>}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(value);
      }}
      className="flex items-center gap-2 lg:mt-2"
    >
      <input
        ref={input}
        value={value}
        autoFocus
        required
        maxLength={120}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        // Escape abandons the edit; blur commits it, so clicking away does the expected thing
        // rather than silently discarding what was typed.
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue(shown);
            setEditing(false);
          }
        }}
        onBlur={() => void save(value)}
        className="h-11 w-full min-w-0 max-w-[640px] rounded-md border border-border-strong px-2.5 text-lead font-bold tracking-snug lg:h-[34px] lg:text-[24px] lg:leading-[30px]"
      />
      <button type="submit" disabled={busy} className="h-11 shrink-0 rounded-md bg-accent-fill px-4 text-copy font-semibold text-white disabled:opacity-60 lg:h-[34px] lg:px-3 lg:text-row">
        {busy ? "Saving…" : "Save"}
      </button>
      {error && <span className="shrink-0 text-body text-danger lg:text-small">{error}</span>}
    </form>
  );
}
