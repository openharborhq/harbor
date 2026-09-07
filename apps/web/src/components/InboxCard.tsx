"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Category, DocumentSummary, Person } from "@trustworthier/shared";
import { api } from "@/lib/api-client";
import { formatBytes, formatRelative, pages } from "@/lib/format";
import { DocThumb } from "./DocThumb";
import { StatusPill, isProcessing } from "./StatusPill";

/**
 * The Inbox card from the Paper design: summary, FILE TO, FOR, accept-or-adjust.
 * Four states: processing, suggestion, no-suggestion (heuristics only), failed.
 */
export function InboxCard({ doc, categories, people }: { doc: DocumentSummary; categories: Category[]; people: Person[] }) {
  const router = useRouter();
  const f = doc.file;
  const s = doc.suggestion;
  const processing = isProcessing(f.processingStatus);
  const hasSummary = Boolean(s?.payload.summary?.trim());

  const [categoryId, setCategoryId] = useState<string | "">(doc.category?.id ?? s?.resolved.categoryId ?? "");
  const [personIds, setPersonIds] = useState<string[]>(doc.people.length ? doc.people.map((p) => p.id) : (s?.resolved.personIds ?? []));
  const [busy, setBusy] = useState<"file" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => groupCategories(categories), [categories]);
  const unchanged = !!s && categoryId === (s.resolved.categoryId ?? "") && sameSet(personIds, s.resolved.personIds);

  async function fileIt() {
    if (!categoryId) return;
    setBusy("file");
    setError(null);
    try {
      if (s && unchanged && !s.acceptedAt) await api(`/documents/${doc.id}/suggestion/accept`, { method: "POST" });
      else await api(`/documents/${doc.id}`, { method: "PATCH", body: JSON.stringify({ categoryId, personIds, ...(s && !doc.title ? { title: s.payload.title } : {}) }) });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  async function notThis() {
    setBusy("reject");
    try {
      await api(`/documents/${doc.id}/suggestion/reject`, { method: "POST" });
      setCategoryId("");
      setPersonIds([]);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const meta = [
    f.version > 1 ? `New version (v${f.version})` : doc.source === "email" ? "Forwarded by email" : "Uploaded",
    formatRelative(f.version > 1 ? doc.updatedAt : doc.createdAt),
    pages(f.pageCount) || formatBytes(f.byteSize),
  ];

  return (
    <article className="flex items-start gap-6 rounded-card border border-border p-6">
      <DocThumb documentId={doc.id} hasThumbnail={f.hasThumbnail} version={f.version} width={200} height={283} dim={processing} />
      <div className="flex min-w-0 flex-1 flex-col gap-[18px] self-stretch">
        <div>
          <Link href={`/documents/${doc.id}`} className="text-section font-semibold tracking-snug hover:text-accent">
            {s && hasSummary && s.payload.title && !s.acceptedAt ? s.payload.title : doc.title}
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
          <div className="flex w-[230px] shrink-0 flex-col gap-1.5">
            <span className="label">For{s && s.resolved.personIds.length && sameSet(personIds, s.resolved.personIds) ? (s.provider === "none" ? " · from text" : " · suggested") : ""}</span>
            <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-[10px] border border-border bg-ground px-2.5 py-1.5">
              {people.length === 0 && <span className="text-row text-muted">Anyone</span>}
              {people.map((p) => {
                const on = personIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={processing}
                    onClick={() => setPersonIds((ids) => (on ? ids.filter((x) => x !== p.id) : [...ids, p.id]))}
                    className={`h-6 rounded-sm px-2 text-small font-semibold ${on ? "bg-accent-soft text-accent" : "bg-surface text-muted hover:text-text"}`}
                  >
                    {p.displayName}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={fileIt}
              disabled={!categoryId || busy !== null || processing}
              className="h-9 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-50"
            >
              {busy === "file" ? "Filing…" : s && unchanged && !s.acceptedAt ? "Accept & file" : "File it"}
            </button>
            {s && !s.rejectedAt && !s.acceptedAt && (
              <button type="button" onClick={notThis} disabled={busy !== null} className="text-row font-medium text-muted hover:text-text">
                {busy === "reject" ? "…" : "Not this"}
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
