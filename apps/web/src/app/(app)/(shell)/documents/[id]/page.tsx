import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { displayTitle, type ActivityEntry, type Category, type DocumentSummary, type DocumentText, type DocumentVersion, type Item, type Task } from "@harbor/shared";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DocumentOverlay } from "@/components/DocumentOverlay";
import { DocumentDetail } from "@/components/DocumentDetail";
import { PdfPages } from "@/components/PdfPages";
import { isProcessing } from "@/components/StatusPill";
import { DocumentTitle } from "@/components/DocumentTitle";
import { ApiError, apiFetch } from "@/lib/api-server";

export const metadata: Metadata = { title: "Document" };

export default async function DocumentPage(props: PageProps<"/documents/[id]">) {
  const { id } = await props.params;
  let doc: DocumentSummary;
  try {
    doc = await apiFetch<DocumentSummary>(`/documents/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const [text, versions, activity, categories, items, tasks] = await Promise.all([
    apiFetch<DocumentText>(`/documents/${id}/text`),
    apiFetch<DocumentVersion[]>(`/documents/${id}/versions`),
    apiFetch<ActivityEntry[]>(`/documents/${id}/activity`),
    apiFetch<Category[]>("/categories"),
    apiFetch<Item[]>("/items"),
    apiFetch<Task[]>(`/tasks?document=${id}`).catch(() => [] as Task[]),
  ]);
  const f = doc.file;
  const fileUrl = `/api/documents/${doc.id}/file`;
  const isImage = f.mimeType.startsWith("image/");

  return (
    <DocumentOverlay
      header={
        <div className="flex min-w-0 items-center justify-between gap-5">
          <div className="min-w-0">
            <DocumentTitle documentId={doc.id} title={displayTitle(doc)} />
            <p className="truncate text-small text-muted">
              <span className={doc.category ? "text-accent" : ""}>{doc.category ? doc.category.path : "Inbox"}</span>
              {doc.items.length ? ` · ${doc.items.map((p) => p.label).join(", ")}` : ""}
            </p>
          </div>
          {/*
            Both ways of taking the document somewhere else, together, where actions on this view
            belong. They were at the bottom of the preview, below the fold on a short window, and
            one of them was a second Download two inches from the first.
          */}
          <span className="flex h-9 shrink-0 items-stretch divide-x divide-border overflow-hidden rounded-md border border-border">
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              title="Open the original in a new tab"
              className="flex items-center gap-1.5 px-3 text-row font-medium transition-colors hover:bg-surface"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
                <path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
              </svg>
              Full
            </a>
            <a
              href={fileUrl}
              download={f.originalFilename}
              className="flex items-center gap-1.5 px-3 text-row font-medium transition-colors hover:bg-surface"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
              Download
            </a>
          </span>
        </div>
      }
    >
      <AutoRefresh active={isProcessing(f.processingStatus)} />

      {/*
        The preview takes whatever height the window has. It was a fixed 720px box inside a page
        that scrolled, which on a laptop meant scrolling to see the bottom of a page that would
        have fitted, and on a large screen meant grey space around a small one.
      */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5 lg:p-6">
        <div className="flex min-h-0 flex-1 items-start justify-center overflow-hidden rounded-lg bg-surface p-6">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl} alt={doc.title} className="max-h-full max-w-full rounded-sm bg-white object-contain shadow-[0_1px_3px_rgba(13,22,34,0.12)]" />
          ) : f.mimeType === "application/pdf" ? (
            <PdfPages url={fileUrl} title={doc.title} />
          ) : (
            <p className="text-body text-muted">No preview for this file type. Download the original instead.</p>
          )}
        </div>
        {/* What the file is, now that what you can do with it lives in the header. */}
        <p className="shrink-0 truncate text-center text-small text-muted">
          {f.originalFilename}
          {f.pageCount ? ` · ${f.pageCount} page${f.pageCount === 1 ? "" : "s"}` : ""} · {Math.max(1, Math.round(f.byteSize / 1024))} KB
        </p>
      </div>

      {/* Its own scroll: five tabs of metadata should never push the document out of view. */}
      <aside className="scrollbar-none flex w-[420px] min-w-[360px] shrink-0 flex-col overflow-y-auto border-l border-border px-6 py-5">
        <DocumentDetail doc={doc} text={text} versions={versions} activity={activity} categories={categories} items={items} tasks={tasks} />
      </aside>
    </DocumentOverlay>
  );
}
