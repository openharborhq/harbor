"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Category, DocumentSummary, DuplicateCandidate, Item, ItemKind } from "@harbor/shared";
import { DocThumb } from "./DocThumb";
import { ItemIcon } from "./ItemIcon";
import { ItemPicker } from "./ItemPicker";
import {
  CategoryOptions,
  InfoIcon,
  ProgressBar,
  ReminderClause,
  WarnIcon,
  failedMessage,
  noSummaryMessage,
  processingHeading,
  processingMessage,
  useInboxCard,
} from "./InboxCard";

/**
 * The Inbox card on a phone (Paper: "02 Inbox — One at a time").
 *
 * The desktop card puts two open fields side by side and the actions under them; on a 390px
 * screen that is a form to fill in for every letter. Here the decision comes first: the page, what
 * it is, where it is going as a sentence of chips, and one button pinned under the thumb. The open
 * fields are still there, one "Change" away, and every action is the desktop card's own — this
 * component only lays out what `useInboxCard` already does.
 */
export function InboxFocusCard({
  doc,
  categories,
  items,
  copies = [],
  nextHref,
}: {
  doc: DocumentSummary;
  categories: Category[];
  items: Item[];
  copies?: DuplicateCandidate[];
  /** The following document, when there is one: the sliver beside the preview links to it. */
  nextHref?: string;
}) {
  const card = useInboxCard({ doc, categories });
  const { fromAddr, f, s, processing, hasSummary, categoryId, setCategoryId, itemIds, setItemIds, busy, confirmDelete, setConfirmDelete, createTasks, setCreateTasks, merging, error, grouped, obligations, forIsSuggested, mergeInto, fileIt, deleteItem, retry, meta, shownTitle, fileLabel } = card;
  const [changing, setChanging] = useState(false);

  const category = categories.find((c) => c.id === categoryId);
  const chosenItems = itemIds.map((id) => items.find((i) => i.id === id)).filter((i): i is Item => i !== undefined);
  const href = `/documents/${doc.id}`;

  return (
    <article className="flex flex-col">
      {/* The page itself, as the design draws it: a sheet rising out of a tinted band, its foot
          cropped. The band is the "Open document" link — a page looks like something to open. The
          sliver to its right is the next card, peeking, so the queue reads as a queue. */}
      <div className={`flex gap-3 ${nextHref ? "-mr-5 sm:-mr-8" : ""}`}>
        <Link
          href={href}
          aria-label={`Open ${shownTitle}`}
          className={`flex h-[200px] min-w-0 flex-1 justify-center overflow-hidden rounded-lg bg-surface pt-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
        >
          <DocThumb documentId={doc.id} hasThumbnail={f.hasThumbnail} version={f.version} width={210} height={297} dim={processing} className="shadow-[0_1px_3px_rgba(13,22,34,0.12)]" />
        </Link>
        {nextHref && <Link href={nextHref} aria-label="Next document" className="w-8 shrink-0 rounded-l-lg bg-surface" />}
      </div>

      <div className="flex flex-col gap-1.5 pt-5">
        <h2 className="text-lead font-bold tracking-snug">{shownTitle}</h2>
        <p className="text-body text-muted">{meta.join(" · ")}</p>
      </div>

      {processing && (
        <div className="flex flex-col gap-2 pt-4">
          <p className="text-copy font-semibold">{processingHeading(f)}</p>
          <p className="text-copy leading-[25px]">{processingMessage(f)}</p>
          <ProgressBar file={f} />
        </div>
      )}

      {!processing && f.processingStatus === "failed" && (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-warn-soft px-4 py-3">
          <WarnIcon />
          <div className="flex flex-col gap-3">
            <p className="text-body">{failedMessage(f)}</p>
            <button type="button" onClick={retry} className="h-11 self-start rounded-md border border-border-strong bg-ground px-4 text-body font-semibold">
              Try again
            </button>
          </div>
        </div>
      )}

      {!processing && f.processingStatus !== "failed" && hasSummary && <p className="pt-2.5 text-copy leading-[25px]">{s!.payload.summary}</p>}

      {!processing && f.processingStatus !== "failed" && !hasSummary && (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-surface px-4 py-3">
          <InfoIcon />
          <p className="text-body">{noSummaryMessage(s)}</p>
        </div>
      )}

      {/* "File to" as a sentence rather than a form: the choice already made, as chips, with the
          two fields it came from behind "Change". */}
      <section className="flex flex-col gap-2.5 pt-5">
        <div className="flex items-center justify-between">
          <h3 className="text-copy font-semibold">File to</h3>
          <button type="button" onClick={() => setChanging((c) => !c)} aria-expanded={changing} className="-my-2.5 -mr-2 h-11 px-2 text-copy font-medium text-accent">
            {changing ? "Done" : "Change"}
          </button>
        </div>

        {changing ? (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-body font-medium text-muted">Category{s?.resolved.categoryId && categoryId === s.resolved.categoryId ? " · suggested" : ""}</span>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={processing}
                className={`h-12 w-full rounded-md border bg-ground px-3.5 ${categoryId ? "border-border-strong font-medium" : "border-border text-muted"}`}
              >
                <CategoryOptions grouped={grouped} />
              </select>
            </label>
            {/* ItemPicker carries its own phone layout: a sentence-case label, a 48px field, and a
                list that joins the flow rather than running under the decision bar. */}
            <ItemPicker
              items={items}
              selected={itemIds}
              onChange={setItemIds}
              disabled={processing}
              label={`For${forIsSuggested ? (s?.provider === "none" ? " · from text" : " · suggested") : ""}`}
            />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {category ? <Chip>{category.name}</Chip> : <Chip muted onClick={() => setChanging(true)}>Choose a category</Chip>}
            {chosenItems.map((i) => (
              <Chip key={i.id} kind={i.kind}>
                {i.label}
              </Chip>
            ))}
          </div>
        )}
      </section>

      {/*
        Advisory, and deliberately not a blocker: filing the card as usual is what "keep both"
        means, so the option that needs no decision needs no button either.
      */}
      {copies.length > 0 && (
        <div className="mt-5 flex flex-col gap-3 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3">
          <p className="text-body">
            Looks like a copy of{" "}
            <Link href={`/documents/${copies[0]!.documentId}`} className="font-semibold underline underline-offset-2">
              {copies[0]!.title}
            </Link>
            {copies[0]!.categoryPath ? <span className="text-muted"> · {copies[0]!.categoryPath}</span> : null}
            <span className="text-muted"> · same page count, near-identical figures</span>
          </p>
          <button
            type="button"
            onClick={() => mergeInto(copies[0]!)}
            disabled={merging || busy !== null || processing}
            className="h-11 self-start rounded-md bg-warn px-4 text-body font-semibold text-white disabled:opacity-50"
          >
            {merging ? "Filing…" : "It is a newer scan of that one"}
          </button>
          <p className="text-body text-muted">Or file this one as usual to keep both.</p>
        </div>
      )}

      {obligations.length > 0 && !s?.acceptedAt && (
        <label className="mt-[18px] flex min-h-[52px] cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3">
          <input type="checkbox" checked={createTasks} onChange={(e) => setCreateTasks(e.target.checked)} disabled={processing} className="size-6 shrink-0 accent-accent" />
          <span className="flex-1 text-copy">
            Remind me to <ReminderClause card={card} currencyClassName="h-9 text-body" />
          </span>
        </label>
      )}

      {/* The decision, pinned under the thumb. The page leaves room for it at the foot (see the
          Inbox page), so nothing scrolls out of reach beneath it. */}
      <div className="fixed inset-x-0 bottom-0 z-20 bg-ground px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:px-8 lg:hidden">
        <div className="flex flex-col gap-2.5">
          {error && <p className="text-body text-danger">{error}</p>}
          {confirmDelete ? (
            <>
              <p className="text-copy font-semibold">Delete it?</p>
              <div className="flex gap-2.5">
                <button type="button" onClick={() => setConfirmDelete(false)} className="h-[50px] flex-1 rounded-lg border border-border text-copy font-semibold">
                  Keep
                </button>
                <button type="button" onClick={() => deleteItem(false)} disabled={busy !== null} className="h-[50px] flex-1 rounded-lg border border-danger/40 text-copy font-semibold text-danger disabled:opacity-50">
                  {busy === "delete" ? "Deleting…" : "Yes, delete"}
                </button>
              </div>
              {/* Only offered when we know who sent it — an upload has no sender to disregard. */}
              {fromAddr && (
                <button type="button" onClick={() => deleteItem(true)} disabled={busy !== null} className="h-[50px] rounded-lg border border-danger/40 px-4 text-copy font-semibold text-danger disabled:opacity-50">
                  {busy === "delete-all" ? "Deleting…" : `Delete and disregard all from ${fromAddr}`}
                </button>
              )}
            </>
          ) : (
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy !== null}
                aria-label="Delete document"
                className="flex size-[50px] shrink-0 items-center justify-center rounded-lg border border-border text-muted disabled:opacity-50"
              >
                <TrashIcon />
              </button>
              <button type="button" onClick={fileIt} disabled={!categoryId || busy !== null || processing} className="h-[50px] min-w-0 flex-1 rounded-lg bg-accent-fill text-copy font-semibold text-white disabled:opacity-50">
                {fileLabel}
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function Chip({ children, kind, muted = false, onClick }: { children: ReactNode; kind?: ItemKind; muted?: boolean; onClick?: () => void }) {
  const cls = `inline-flex h-11 max-w-full items-center gap-1.5 rounded-pill px-4 text-[16px] font-semibold ${muted ? "border border-dashed border-border-strong text-muted" : "bg-accent-soft text-accent"}`;
  const body = (
    <>
      {kind && <ItemIcon kind={kind} size={16} />}
      <span className="truncate">{children}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  );
}

function TrashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}
