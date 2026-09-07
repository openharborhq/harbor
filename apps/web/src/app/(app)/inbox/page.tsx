import type { Metadata } from "next";
import Link from "next/link";
import type { DocumentSummary } from "@trustworthier/shared";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DocumentCard } from "@/components/DocumentCard";
import { isProcessing } from "@/components/StatusPill";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const docs = await apiFetch<DocumentSummary[]>("/documents?inbox=1");
  const processing = docs.filter((d) => isProcessing(d.file.processingStatus)).length;
  const groups = groupByDay(docs);

  return (
    <>
      <TopBar />
      <AutoRefresh active={processing > 0} />
      <main className="flex max-w-[1192px] flex-col gap-10 px-14 py-14">
        <div>
          <h1 className="text-title font-bold tracking-snug">Inbox</h1>
          <p className="mt-1.5 text-body text-muted">
            {docs.length === 0
              ? "Nothing to review."
              : `${docs.length} document${docs.length === 1 ? "" : "s"} to review${processing ? ` · ${processing} still being read` : ""}`}
          </p>
        </div>

        {docs.length === 0 && (
          <div className="rounded-card border border-dashed border-border-strong p-12 text-center">
            <p className="text-section font-semibold tracking-snug">Your Inbox is empty</p>
            <p className="mt-2 text-body text-muted">
              Drop paperwork on the{" "}
              <Link href="/add" className="font-medium text-accent">
                Add documents
              </Link>{" "}
              page — everything lands here first.
            </p>
          </div>
        )}

        {groups.map(([day, items]) => (
          <section key={day} className="flex flex-col gap-4">
            <h2 className="text-body font-semibold">{day}</h2>
            {items.map((d) => (
              <DocumentCard key={d.id} doc={d} />
            ))}
          </section>
        ))}
      </main>
    </>
  );
}

function groupByDay(docs: DocumentSummary[]): [string, DocumentSummary[]][] {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  const map = new Map<string, DocumentSummary[]>();
  for (const d of docs) {
    const ds = new Date(d.createdAt).toDateString();
    const label = ds === today ? "Today" : ds === yesterday ? "Yesterday" : new Date(d.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
    map.set(label, [...(map.get(label) ?? []), d]);
  }
  return [...map.entries()];
}
