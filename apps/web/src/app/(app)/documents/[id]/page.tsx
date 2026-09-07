import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ActivityEntry, Category, DocumentSummary, DocumentText, DocumentVersion, Person } from "@trustworthier/shared";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DocumentDetail } from "@/components/DocumentDetail";
import { isProcessing } from "@/components/StatusPill";
import { TopBar } from "@/components/shell/TopBar";
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
  const [text, versions, activity, categories, people] = await Promise.all([
    apiFetch<DocumentText>(`/documents/${id}/text`),
    apiFetch<DocumentVersion[]>(`/documents/${id}/versions`),
    apiFetch<ActivityEntry[]>(`/documents/${id}/activity`),
    apiFetch<Category[]>("/categories"),
    apiFetch<Person[]>("/people"),
  ]);
  const f = doc.file;
  const fileUrl = `/api/documents/${doc.id}/file`;
  const isImage = f.mimeType.startsWith("image/");

  return (
    <>
      <TopBar />
      <AutoRefresh active={isProcessing(f.processingStatus)} />
      <main className="flex max-w-[1192px] flex-col gap-6 px-14 py-8">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <Link href={doc.category ? "/library" : "/inbox"} className="text-small font-medium text-accent">
              ← {doc.category ? "Library" : "Inbox"}
            </Link>
            <h1 className="mt-2 truncate text-[24px] font-bold leading-[30px] tracking-snug">{doc.title}</h1>
            <p className="mt-1 text-row text-muted">
              <span className={doc.category ? "text-accent" : ""}>{doc.category ? doc.category.path : "Inbox"}</span>
              {doc.people.length ? ` · ${doc.people.map((p) => p.displayName).join(", ")}` : ""}
            </p>
          </div>
          <a href={fileUrl} download={f.originalFilename} className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-border bg-ground px-4 text-row font-medium">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            Download
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
          <DocumentDetail doc={doc} text={text} versions={versions} activity={activity} categories={categories} people={people} />
        </div>
      </main>
    </>
  );
}
