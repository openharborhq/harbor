import type { Metadata } from "next";
import Link from "next/link";
import type { DocumentSummary, SearchResponse } from "@trustworthier/shared";
import { Snippet } from "@/components/Snippet";
import { StatusPill } from "@/components/StatusPill";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";
import { formatDate, formatRelative, pages } from "@/lib/format";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage(props: PageProps<"/library">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  if (q) {
    const result = await apiFetch<SearchResponse>(`/search?q=${encodeURIComponent(q)}`);
    return (
      <>
        <TopBar query={q} />
        <main className="flex max-w-[1192px] flex-col gap-8 px-14 py-14">
          <div>
            <h1 className="text-title font-bold tracking-snug">Library</h1>
            <p className="mt-1.5 text-body text-muted">Every document in the vault, including the words inside them.</p>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-section font-semibold tracking-snug">
                {result.total} result{result.total === 1 ? "" : "s"} for &ldquo;{q}&rdquo;
              </h2>
              <span className="text-small text-muted">{result.tookMs} ms</span>
            </div>
            <Link href="/library" className="text-row font-medium text-accent">
              Clear search
            </Link>
          </div>
          {result.hits.length === 0 && (
            <p className="text-body text-muted">No document contains that. Search looks at titles and the text read from every page; spelling must match.</p>
          )}
          <ul className="flex flex-col">
            {result.hits.map((h) => (
              <li key={h.documentId} className="flex items-start gap-4 border-t border-border py-4 last:border-b">
                <div className="h-14 w-11 shrink-0 rounded-sm border border-border bg-surface" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-baseline gap-2.5">
                    <Link href={`/documents/${h.documentId}`} className="text-row font-semibold hover:text-accent">
                      {h.title}
                    </Link>
                    <span className="text-small text-muted">
                      {h.categoryPath ?? "Inbox"} · {h.documentDate ? formatDate(h.documentDate) : "no date yet"}
                    </span>
                  </div>
                  <Snippet html={h.snippetHtml} />
                </div>
                <span className="w-24 shrink-0 text-right text-small text-muted">{h.source === "email" ? "Email" : "Upload"}</span>
              </li>
            ))}
          </ul>
        </main>
      </>
    );
  }

  const docs = await apiFetch<DocumentSummary[]>("/documents");
  return (
    <>
      <TopBar />
      <main className="flex max-w-[1192px] flex-col gap-8 px-14 py-14">
        <div>
          <h1 className="text-title font-bold tracking-snug">Library</h1>
          <p className="mt-1.5 text-body text-muted">
            {docs.length} document{docs.length === 1 ? "" : "s"} · search above to look inside them.
          </p>
        </div>
        <ul className="flex flex-col">
          {docs.map((d) => (
            <li key={d.id} className="flex h-14 items-center gap-4 border-t border-border last:border-b">
              <div className="h-[38px] w-[30px] shrink-0 rounded-sm border border-border bg-surface" />
              <Link href={`/documents/${d.id}`} className="w-[420px] truncate text-row font-semibold hover:text-accent">
                {d.title}
              </Link>
              <span className="flex-1 text-small text-muted">
                {d.source === "email" ? "Email" : "Upload"} · {formatRelative(d.createdAt)}
                {d.file.pageCount ? ` · ${pages(d.file.pageCount)}` : ""}
              </span>
              <StatusPill status={d.file.processingStatus} />
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
