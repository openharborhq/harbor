import Link from "next/link";
import type { DocumentSummary } from "@trustworthier/shared";
import { formatBytes, formatRelative, pages } from "@/lib/format";
import { StatusPill, isProcessing } from "./StatusPill";

/** Inbox card, milestone-1 form: the summary/suggestion block arrives with the LLM pass (M2). */
export function DocumentCard({ doc }: { doc: DocumentSummary }) {
  const f = doc.file;
  const processing = isProcessing(f.processingStatus);
  const meta = [
    doc.source === "email" ? "Forwarded by email" : "Uploaded",
    formatRelative(doc.createdAt),
    pages(f.pageCount) || formatBytes(f.byteSize),
  ].filter(Boolean);

  return (
    <article className="flex items-start gap-6 rounded-card border border-border p-6">
      <Thumbnail dim={processing} />
      <div className="flex min-w-0 flex-1 flex-col gap-4 self-stretch">
        <div>
          <Link href={`/documents/${doc.id}`} className="text-section font-semibold tracking-snug hover:text-accent">
            {doc.title}
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
            <div className="label">Making searchable</div>
            <p className="text-body">
              {f.processingStatus === "ocr" && f.pageProgress !== null && f.pageCount
                ? `Reading page ${Math.max(1, Math.round(f.pageProgress * f.pageCount))} of ${f.pageCount} — the text arrives when it's done.`
                : "Reading the document — this takes a few seconds per scanned page."}
            </p>
            <div className="h-1 w-[280px] overflow-hidden rounded-pill bg-surface">
              <div className="h-1 rounded-pill bg-accent transition-[width]" style={{ width: `${Math.round((f.pageProgress ?? 0.05) * 100)}%` }} />
            </div>
          </div>
        )}
        {f.processingStatus === "failed" && (
          <div className="flex items-start gap-2.5 rounded-md bg-warn-soft px-3.5 py-3">
            <WarnIcon />
            <p className="text-row leading-5">
              Couldn&rsquo;t make this searchable — {f.processingError ?? "the reading step failed"}. The original is safe and can be filed as-is.
            </p>
          </div>
        )}
        {f.processingStatus === "ready" && (
          <p className="text-body text-muted">Searchable. Filing and suggestions arrive in the next milestone — open it to view the original.</p>
        )}

        <div className="mt-auto flex items-center justify-between">
          <StatusPill status={f.processingStatus} />
          <Link href={`/documents/${doc.id}`} className="text-row font-medium text-accent">
            Open document
          </Link>
        </div>
      </div>
    </article>
  );
}

export function Thumbnail({ dim = false, className = "" }: { dim?: boolean; className?: string }) {
  return (
    <div className={`flex h-[283px] w-[200px] shrink-0 flex-col gap-2 rounded-md border border-border bg-ground p-5 ${dim ? "opacity-55" : ""} ${className}`}>
      <div className="h-2.5 w-14 rounded-sm bg-text" />
      <div className="h-1.5 w-20 rounded-sm bg-border-strong" />
      <div className="mt-3 h-1.5 w-full rounded-sm bg-border" />
      <div className="h-1.5 w-full rounded-sm bg-border" />
      <div className="h-1.5 w-2/3 rounded-sm bg-border" />
      <div className="mt-3 h-1.5 w-full rounded-sm bg-border" />
      <div className="h-1.5 w-full rounded-sm bg-border" />
      <div className="h-1.5 w-1/2 rounded-sm bg-border" />
    </div>
  );
}

function WarnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="mt-0.5 shrink-0 text-warn">
      <path d="M8 2.5 14 13H2L8 2.5Z" strokeLinejoin="round" />
      <path d="M8 6.5v3M8 11.2v.3" strokeLinecap="round" />
    </svg>
  );
}
