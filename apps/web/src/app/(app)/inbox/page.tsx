import type { Metadata } from "next";
import Link from "next/link";
import type { Category, DocumentSummary, Person } from "@trustworthier/shared";
import { AcceptAll } from "@/components/AcceptAll";
import { AutoRefresh } from "@/components/AutoRefresh";
import { InboxCard } from "@/components/InboxCard";
import { isProcessing } from "@/components/StatusPill";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const [docs, categories, people] = await Promise.all([
    apiFetch<DocumentSummary[]>("/documents?inbox=1"),
    apiFetch<Category[]>("/categories"),
    apiFetch<Person[]>("/people"),
  ]);
  const processing = docs.filter((d) => isProcessing(d.file.processingStatus)).length;
  const suggested = docs.filter((d) => d.suggestion?.resolved.categoryId && !d.suggestion.rejectedAt).length;
  const eligible = docs.filter((d) => d.suggestion && d.suggestion.payload.confidence === "high" && d.suggestion.resolved.categoryId && !d.suggestion.acceptedAt && !d.suggestion.rejectedAt).length;
  const groups = groupByDay(docs);

  return (
    <>
      <TopBar />
      <AutoRefresh active={processing > 0} />
      <main className="flex max-w-[1192px] flex-col gap-10 px-14 py-14">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-title font-bold tracking-snug">Inbox</h1>
            <p className="mt-1.5 text-body text-muted">
              {docs.length === 0
                ? "Nothing to review."
                : `${docs.length} document${docs.length === 1 ? "" : "s"} to review${suggested ? ` · ${suggested} ${suggested === 1 ? "has" : "have"} a suggested filing location` : ""}${processing ? ` · ${processing} still being read` : ""}`}
            </p>
          </div>
          {docs.length > 0 && <AcceptAll eligible={eligible} />}
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
              <InboxCard key={`${d.id}-${d.file.processingStatus}-${d.suggestion?.id ?? "none"}`} doc={d} categories={categories} people={people} />
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
    const ds = new Date(d.updatedAt).toDateString();
    const label = ds === today ? "Today" : ds === yesterday ? "Yesterday" : new Date(d.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
    map.set(label, [...(map.get(label) ?? []), d]);
  }
  return [...map.entries()];
}
