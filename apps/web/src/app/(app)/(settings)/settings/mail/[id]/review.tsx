"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BackfillCandidateSender } from "@harbor/shared";
import { api } from "@/lib/api-client";

const primary = "h-9 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-60";
const secondary = "h-9 rounded-md border border-border bg-ground px-4 text-row font-medium disabled:opacity-60";

/**
 * The backfill review (§7.6). The whole design question here is what the unit of decision is, and
 * the answer is the sender: 142 messages is not a decision anyone can make, 23 senders is. Select
 * a few, say where their paperwork goes once, and their backlog and their future mail both follow.
 */
export function SenderReview({
  connectionId,
  candidates,
  categories,
}: {
  connectionId: string;
  candidates: BackfillCandidateSender[];
  categories: { slug: string; path: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categorySlug, setCategorySlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undecided = candidates.filter((c) => c.decision === null);
  const decided = candidates.filter((c) => c.decision !== null);

  function toggle(addr: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) next.delete(addr);
      else next.add(addr);
      return next;
    });
  }

  async function decide(decision: "file" | "ignore") {
    if (!selected.size) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/mail/connections/${connectionId}/senders`, {
        method: "POST",
        body: JSON.stringify({
          fromAddrs: [...selected],
          decision,
          defaultCategorySlug: decision === "file" && categorySlug ? categorySlug : null,
        }),
      });
      setSelected(new Set());
      setCategorySlug("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-[880px] rounded-lg border border-border">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className="flex-1">
          <h2 className="text-section font-semibold tracking-snug">Who sends you paperwork</h2>
          <p className="mt-0.5 text-small text-muted">Approve a sender once and you never file their post by hand again.</p>
        </div>
        {undecided.length > 0 && (
          <button
            type="button"
            className={secondary}
            onClick={() => setSelected(selected.size === undecided.length ? new Set() : new Set(undecided.map((c) => c.fromAddr)))}
          >
            {selected.size === undecided.length ? "Clear" : "Select all"}
          </button>
        )}
      </div>

      <ul className="px-5 py-1">
        {undecided.map((c) => (
          <li key={c.fromAddr} className="flex items-center gap-3.5 border-t border-border py-3 first:border-t-0">
            <input
              type="checkbox"
              checked={selected.has(c.fromAddr)}
              onChange={() => toggle(c.fromAddr)}
              className="size-4 shrink-0 accent-accent"
              aria-label={`Select ${c.fromAddr}`}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-row font-medium">{c.fromAddr}</div>
              <div className="truncate text-small text-muted">
                {c.messages} {c.messages === 1 ? "message" : "messages"}
                {c.withAttachments > 0 && ` · ${c.withAttachments} with attachments`}
                {c.sampleSubject && ` · “${c.sampleSubject}”`}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface px-5 py-4">
          <span className="text-row font-medium">
            {selected.size} {selected.size === 1 ? "sender" : "senders"}
          </span>
          <select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className="h-9 rounded-md border border-border-strong px-2.5 text-row">
            <option value="">File to the Inbox</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.path}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={() => decide("file")} className={primary}>
            {busy ? "Saving…" : "File their mail"}
          </button>
          <button type="button" disabled={busy} onClick={() => decide("ignore")} className={secondary}>
            Ignore
          </button>
          {error && <span className="text-small text-danger">{error}</span>}
        </div>
      )}

      {decided.length > 0 && (
        <div className="border-t border-border px-5 py-4">
          <h3 className="text-small font-semibold uppercase tracking-label text-muted">Already decided</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {decided.map((c) => (
              <li key={c.fromAddr} className="flex items-center gap-2 text-small">
                <span className={c.decision === "file" ? "text-accent" : "text-muted"}>{c.decision === "file" ? "Filing" : "Ignoring"}</span>
                <span className="truncate">{c.fromAddr}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
