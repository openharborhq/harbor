"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { displayTitle, formatAmount, shortDate, type Category, type DocumentSummary, type DuplicateCandidate, type Item, type MuteResult } from "@harbor/shared";
import { ItemPicker } from "./ItemPicker";
import { api } from "@/lib/api-client";
import { formatBytes, formatRelative, pages } from "@/lib/format";
import { DocThumb } from "./DocThumb";
import { StatusPill, isProcessing } from "./StatusPill";

/**
 * The Inbox card from the Paper design: summary, FILE TO, FOR, accept-or-adjust.
 * Four states: processing, suggestion, no-suggestion (heuristics only), failed.
 */
export function InboxCard({ doc, categories, items, copies = [] }: { doc: DocumentSummary; categories: Category[]; items: Item[]; copies?: DuplicateCandidate[] }) {
  /** Who emailed it. On the document itself, so pruning the ingest log cannot take it away (§7). */
  const fromAddr = doc.mailFrom;
  const router = useRouter();
  const f = doc.file;
  const s = doc.suggestion;
  const processing = isProcessing(f.processingStatus);
  const hasSummary = Boolean(s?.payload.summary?.trim());

  const [categoryId, setCategoryId] = useState<string | "">(doc.category?.id ?? s?.resolved.categoryId ?? "");
  // Union, not either/or: an upload's FOR default was a deliberate choice, and the suggestion is
  // strictly more informed — showing only one of the two hides work the filer would have to redo.
  const [itemIds, setItemIds] = useState<string[]>([...new Set([...doc.items.map((i) => i.id), ...(s?.resolved.itemIds ?? [])])]);
  const [busy, setBusy] = useState<"file" | "delete" | "delete-all" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /**
   * The reminder rides on the filing action as a clause you can untick, not as a second button:
   * noticing a bill needs paying and filing it are one moment (spec §8). Ticked by default,
   * because a to-do you never see is worse than one you have to dismiss.
   */
  const [createTasks, setCreateTasks] = useState(true);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => groupCategories(categories), [categories]);
  const unchanged = !!s && categoryId === (s.resolved.categoryId ?? "") && sameSet(itemIds, [...new Set([...doc.items.map((i) => i.id), ...s.resolved.itemIds])]);
  /** The FOR selection still holds everything the model proposed. */
  /** What the model says still has to be done. Proposals — nothing exists until this card is filed. */
  const obligations = s && !s.rejectedAt ? (s.payload.obligations ?? []) : [];
  const forIsSuggested = !!s && s.resolved.itemIds.length > 0 && s.resolved.itemIds.every((id) => itemIds.includes(id));

  /** "It is the same paper" — this file becomes the next version of the one already filed. */
  async function mergeInto(target: DuplicateCandidate) {
    setMerging(true);
    setError(null);
    try {
      await api(`/documents/${doc.id}/merge-into/${target.documentId}`, { method: "POST" });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setMerging(false);
    }
  }

  async function fileIt() {
    if (!categoryId) return;
    setBusy("file");
    setError(null);
    try {
      // Accepting sends the card's own category/items so filing can never silently no-op.
      if (s && !s.rejectedAt) await api(`/documents/${doc.id}/suggestion/accept`, { method: "POST", body: JSON.stringify({ categoryId, itemIds, createTasks }) });
      else await api(`/documents/${doc.id}`, { method: "PATCH", body: JSON.stringify({ categoryId, itemIds }) });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  /**
   * Soft delete: the card leaves the Inbox and waits in Recently deleted (spec §1 deleted_at).
   *
   * The moment you delete something is also the moment you know whether you ever want it again,
   * so the confirmation is where "and never from this sender" belongs (§7.6). Muting sweeps the
   * rest of that sender's unfiled mail too — deleting one Spotify receipt and leaving the other
   * eleven would not be what anyone meant.
   */
  async function deleteItem(alsoMute = false) {
    setBusy(alsoMute ? "delete-all" : "delete");
    try {
      if (alsoMute && fromAddr) {
        /**
         * The mute sweeps every unfiled document from this sender — which includes this one, so
         * it is the whole delete, not a step before it. Deleting again afterwards asked the API
         * for a document that was already gone and failed with "Document not found", making a
         * successful bulk action look like a broken one.
         */
        const { deleted } = await api<MuteResult>("/mail/senders/mute", { method: "POST", body: JSON.stringify({ fromAddrs: [fromAddr], deleteFiled: true }) });
        // If the sweep matched nothing — an attribution mismatch, say — the button would have
        // muted the sender and left the card sitting there, which reads as "nothing happened".
        // It says delete, so it deletes.
        if (deleted === 0) await api(`/documents/${doc.id}`, { method: "DELETE" });
      } else {
        await api(`/documents/${doc.id}`, { method: "DELETE" });
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  const meta = [
    f.version > 1 ? `New version (v${f.version})` : doc.source === "email" ? "Forwarded by email" : "Uploaded",
    formatRelative(f.version > 1 ? doc.updatedAt : doc.createdAt),
    pages(f.pageCount) || formatBytes(f.byteSize),
  ];

  const shownTitle = displayTitle(doc);

  return (
    <article className="flex items-start gap-6 rounded-card border border-border p-6">
      <DocThumb documentId={doc.id} hasThumbnail={f.hasThumbnail} version={f.version} width={200} height={283} dim={processing} href={`/documents/${doc.id}`} label={shownTitle} />
      <div className="flex min-w-0 flex-1 flex-col gap-[18px] self-stretch">
        <div>
          <Link href={`/documents/${doc.id}`} className="text-section font-semibold tracking-snug hover:text-accent">
            {shownTitle}
          </Link>
          <div className="mt-1 flex items-center gap-2 text-small text-muted">
            {meta.map((m, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <span className="size-[3px] rounded-pill bg-border-strong" />}
                {m}
              </span>
            ))}
          </div>
        </div>

        {processing && (
          <div className="flex flex-col gap-2">
            <div className="label">{f.processingStatus === "suggesting" ? "Thinking about where it goes" : "Making searchable"}</div>
            <p className="text-[16px] leading-6">
              {f.processingStatus === "suggesting"
                ? "The text is in. Reading it for a summary and a filing suggestion — a few seconds."
                : f.processingStatus === "ocr" && f.pageProgress !== null && f.pageCount
                  ? `Reading page ${Math.max(1, Math.round(f.pageProgress * f.pageCount))} of ${f.pageCount} — the summary and filing suggestion arrive when it's done.`
                  : "Reading the document — a few seconds per scanned page."}
            </p>
            <div className="h-1 w-[280px] overflow-hidden rounded-pill bg-surface">
              <div className="h-1 rounded-pill bg-accent transition-[width]" style={{ width: `${Math.round((f.processingStatus === "suggesting" ? 0.9 : (f.pageProgress ?? 0.05)) * 100)}%` }} />
            </div>
          </div>
        )}

        {!processing && f.processingStatus === "failed" && (
          <div className="flex items-start gap-2.5 rounded-md bg-warn-soft px-3.5 py-3">
            <WarnIcon />
            <div className="flex flex-col gap-2">
              <p className="text-row leading-5">Couldn&rsquo;t make this searchable — {f.processingError ?? "the reading step failed"}. The original is safe and can be filed as-is.</p>
              <button
                type="button"
                onClick={async () => {
                  await api(`/documents/${doc.id}/reprocess`, { method: "POST" });
                  router.refresh();
                }}
                className="self-start rounded-md border border-border-strong bg-ground px-3 py-1 text-small font-semibold"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {!processing && f.processingStatus !== "failed" && hasSummary && (
          <div className="flex flex-col gap-1.5">
            <div className="label">Summary</div>
            <p className="text-[16px] leading-6">{s!.payload.summary}</p>
          </div>
        )}

        {!processing && f.processingStatus !== "failed" && !hasSummary && (
          <div className="flex items-start gap-2.5 rounded-md bg-surface px-3.5 py-3">
            <InfoIcon />
            <p className="text-row leading-5">
              {s
                ? "No summary — suggestions are running in offline mode, so this is a best guess from the file name and sender. File it by hand, or open it to check."
                : "No suggestion for this one — too little readable text on the page to go on. File it by hand, or open it to check."}
            </p>
          </div>
        )}

        <div className="mt-auto flex items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="label">File to{s?.resolved.categoryId && categoryId === s.resolved.categoryId ? " · suggested" : ""}</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={processing}
              className={`h-[42px] rounded-[10px] border bg-ground px-3.5 text-row ${categoryId ? "border-border-strong font-medium" : "border-border text-muted"}`}
            >
              <option value="">Choose a category</option>
              {grouped.map(([parent, children]) => (
                <optgroup key={parent.id} label={parent.name}>
                  <option value={parent.id}>{parent.name}</option>
                  {children.map((c) => (
                    <option key={c.id} value={c.id}>
                      {parent.name} › {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="w-[300px] shrink-0">
            <ItemPicker
              items={items}
              selected={itemIds}
              onChange={setItemIds}
              disabled={processing}
              label={`For${forIsSuggested ? (s.provider === "none" ? " · from text" : " · suggested") : ""}`}
            />
          </div>
        </div>

        {/*
          Advisory, and deliberately not a blocker: filing the card as usual is what "keep both"
          means, so the option that needs no decision needs no button either.
        */}
        {copies.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-warn/30 bg-warn-soft px-3.5 py-3">
            <div className="text-row">
              Looks like a copy of{" "}
              <Link href={`/documents/${copies[0]!.documentId}`} className="font-semibold underline underline-offset-2">
                {copies[0]!.title}
              </Link>
              {copies[0]!.categoryPath ? <span className="text-muted"> · {copies[0]!.categoryPath}</span> : null}
              <span className="text-muted"> · same page count, near-identical figures</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => mergeInto(copies[0]!)}
                disabled={merging || busy !== null || processing}
                className="h-8 rounded-md bg-warn px-3 text-small font-medium text-white disabled:opacity-50"
              >
                {merging ? "Filing…" : "It is a newer scan of that one"}
              </button>
              <span className="text-small text-muted">or file this one as usual to keep both.</span>
            </div>
          </div>
        )}

        {obligations.length > 0 && !s?.acceptedAt && (
          <label className="flex cursor-pointer items-center gap-3 rounded-md bg-accent-soft px-3.5 py-3">
            <input
              type="checkbox"
              checked={createTasks}
              onChange={(e) => setCreateTasks(e.target.checked)}
              disabled={processing}
              className="h-[18px] w-[18px] shrink-0 accent-accent"
            />
            <span className="flex-1 text-row">
              …and remind me to{" "}
              {obligations.map((o, i) => (
                <span key={`${o.title}-${i}`}>
                  {i > 0 && ", then "}
                  <span className="font-semibold">
                    {o.amountCents !== null ? `pay ${formatAmount(o.amountCents, o.currency)}` : o.title.toLowerCase()}
                  </span>
                  {o.dueOn && (
                    <>
                      {" by "}
                      <span className="font-semibold">{shortDate(o.dueOn)}</span>
                    </>
                  )}
                </span>
              ))}
            </span>
          </label>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={fileIt}
              disabled={!categoryId || busy !== null || processing}
              className="h-9 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-50"
            >
              {busy === "file" ? "Filing…" : s && unchanged && !s.rejectedAt ? "Accept & file" : "File it"}
            </button>
            {confirmDelete ? (
              <span className="flex flex-wrap items-center gap-3 text-row">
                <span className="text-muted">Delete it?</span>
                <button type="button" onClick={() => deleteItem(false)} disabled={busy !== null} className="font-semibold text-danger hover:underline underline-offset-2">
                  {busy === "delete" ? "Deleting…" : "Yes, delete"}
                </button>
                {/* Only offered when we know who sent it — an upload has no sender to disregard. */}
                {fromAddr && (
                  <button
                    type="button"
                    onClick={() => deleteItem(true)}
                    disabled={busy !== null}
                    title={`Delete this, remove everything else from ${fromAddr} still waiting, and never file from them again`}
                    className="font-semibold text-danger hover:underline underline-offset-2"
                  >
                    {busy === "delete-all" ? "Deleting…" : "Delete and disregard all"}
                  </button>
                )}
                <button type="button" onClick={() => setConfirmDelete(false)} className="font-medium text-muted">
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy !== null} className="text-row font-medium text-muted hover:text-danger">
                Delete item
              </button>
            )}
            {error && <span className="text-small text-danger">{error}</span>}
          </div>
          <div className="flex items-center gap-3">
            <StatusPill status={f.processingStatus} />
            <Link href={`/documents/${doc.id}`} className="text-row font-medium text-accent">
              Open document
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

function groupCategories(cats: Category[]): [Category, Category[]][] {
  const tops = cats.filter((c) => c.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
  return tops.map((t) => [t, cats.filter((c) => c.parentId === t.id).sort((a, b) => a.sortOrder - b.sortOrder)]);
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function WarnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="mt-0.5 shrink-0 text-warn">
      <path d="M8 2.5 14 13H2L8 2.5Z" strokeLinejoin="round" />
      <path d="M8 6.5v3M8 11.2v.3" strokeLinecap="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="mt-0.5 shrink-0 text-muted">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v3.6M8 5v.3" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}
