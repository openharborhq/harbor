import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { DocumentSummary } from "@trustworthier/shared";
import { AutoRefresh } from "@/components/AutoRefresh";
import { StatusPill, isProcessing } from "@/components/StatusPill";
import { TopBar } from "@/components/shell/TopBar";
import { ApiError, apiFetch } from "@/lib/api-server";
import { formatBytes, formatDate, pages } from "@/lib/format";

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
  const f = doc.file;
  const fileUrl = `/api/documents/${doc.id}/file`;
  const isImage = f.mimeType.startsWith("image/");

  return (
    <>
      <TopBar />
      <AutoRefresh active={isProcessing(f.processingStatus)} />
      <main className="flex max-w-[1192px] flex-col gap-8 px-14 py-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <Link href="/inbox" className="text-small font-medium text-accent">
              ← Inbox
            </Link>
            <h1 className="mt-2 text-title font-bold tracking-snug">{doc.title}</h1>
            <p className="mt-1 text-body text-muted">
              {doc.categoryId ? "Filed" : "Inbox"} · {f.originalFilename}
            </p>
          </div>
          <a href={fileUrl} download={f.originalFilename} className="flex h-10 items-center gap-2 rounded-md border border-border bg-ground px-4 text-row font-medium">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            Download original
          </a>
        </div>

        <div className="flex gap-8">
          <div className="flex h-[720px] flex-1 items-start justify-center overflow-hidden rounded-lg bg-surface p-6">
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl} alt={doc.title} className="max-h-full max-w-full rounded-sm border border-border bg-white object-contain" />
            ) : f.mimeType === "application/pdf" ? (
              <iframe src={fileUrl} title={doc.title} className="h-full w-full rounded-sm border border-border bg-white" />
            ) : (
              <p className="text-body text-muted">No preview for this file type. Download the original instead.</p>
            )}
          </div>

          <aside className="flex w-[420px] shrink-0 flex-col">
            <div className="rounded-lg bg-surface p-4">
              <div className="label">Status</div>
              <div className="mt-2 flex items-center gap-3">
                <StatusPill status={f.processingStatus} />
                {f.processingError && <span className="text-small text-warn">{f.processingError}</span>}
              </div>
              <p className="mt-3 text-small text-muted">Summary and filing suggestions arrive in the next milestone.</p>
            </div>
            <dl className="mt-4 divide-y divide-border text-row">
              <Row k="Category" v={doc.categoryId ? "Filed" : "Inbox — not filed yet"} />
              <Row k="Added" v={`${formatDate(doc.createdAt)} · ${doc.source === "email" ? "email" : "upload"}`} />
              <Row k="File" v={`${f.originalFilename} · ${pages(f.pageCount) || "—"} · ${formatBytes(f.byteSize)}`} />
              <Row k="Type" v={f.mimeType} />
            </dl>
          </aside>
        </div>
      </main>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-4 py-3">
      <dt className="w-32 shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 flex-1 break-words font-medium">{v}</dd>
    </div>
  );
}
