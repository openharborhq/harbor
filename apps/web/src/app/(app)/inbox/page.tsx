import type { Metadata } from "next";
import Link from "next/link";
import type { Category, DocumentSummary, Item } from "@harbor/shared";
import { AcceptAll } from "@/components/AcceptAll";
import { AutoRefresh } from "@/components/AutoRefresh";
import { InboxCard } from "@/components/InboxCard";
import { isProcessing } from "@/components/StatusPill";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage(props: PageProps<"/inbox">) {
  const sp = await props.searchParams;
  const source = sp.source === "email" || sp.source === "upload" ? sp.source : null;

  // Counts come from the unfiltered list so the tabs can show them; the filter is applied here
  // rather than in a second request, because the Inbox is small by construction.
  const [all, categories, items] = await Promise.all([
    apiFetch<DocumentSummary[]>("/documents?inbox=1"),
    apiFetch<Category[]>("/categories"),
    apiFetch<Item[]>("/items"),
  ]);
  const counts = { all: all.length, upload: all.filter((d) => d.source === "upload").length, email: all.filter((d) => d.source === "email").length };
  const docs = source ? all.filter((d) => d.source === source) : all;
  const processing = docs.filter((d) => isProcessing(d.file.processingStatus)).length;
  const suggested = docs.filter((d) => d.suggestion?.resolved.categoryId && !d.suggestion.rejectedAt).length;
  const eligible = docs.filter((d) => d.suggestion && d.suggestion.payload.confidence !== "low" && d.suggestion.resolved.categoryId && !d.suggestion.acceptedAt && !d.suggestion.rejectedAt).length;
  /**
   * Always chronological. Grouping by sender was tried and removed: a backlog reaching months
   * back turns into a wall of headings for correspondents you last heard from in spring, and the
   * thing you actually want — what arrived recently — gets pushed off the screen. The decision
   * about a sender belongs where you make it, on the document you are deleting, not in the
   * structure of the whole list.
   */
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

        {/* Two streams arrive here and they are reviewed differently: a scan you just made needs
            a glance, a fortnight of emailed invoices needs a sitting. Splitting them is the
            difference between the Inbox being a queue and being a pile. */}
        {counts.email > 0 && counts.upload > 0 && (
          <nav className="-mt-4 flex gap-1.5">
            <SourceTab label="Everything" count={counts.all} href="/inbox" active={source === null} />
            <SourceTab label="Uploaded" count={counts.upload} href="/inbox?source=upload" active={source === "upload"} />
            <SourceTab label="From email" count={counts.email} href="/inbox?source=email" active={source === "email"} />
          </nav>
        )}

        {docs.length === 0 && (
          <div className="rounded-card border border-dashed border-border-strong p-12 text-center">
            <p className="text-section font-semibold tracking-snug">
              {source === "email" ? "Nothing from email to review" : source === "upload" ? "Nothing uploaded to review" : "Your Inbox is empty"}
            </p>
            <p className="mt-2 text-body text-muted">
              {source ? (
                <Link href="/inbox" className="font-medium text-accent">
                  See everything in the Inbox
                </Link>
              ) : (
                <>
                  Drop paperwork on the{" "}
                  <Link href="/add" className="font-medium text-accent">
                    Add documents
                  </Link>{" "}
                  page, or{" "}
                  <Link href="/settings/mail" className="font-medium text-accent">
                    connect a mailbox
                  </Link>{" "}
                  — everything lands here first.
                </>
              )}
            </p>
          </div>
        )}

        {groups.map(([heading, groupDocs]) => (
          <section key={heading} className="flex flex-col gap-4">
            <h2 className="text-body font-semibold">{heading}</h2>
            {groupDocs.map((d) => (
              <InboxCard key={`${d.id}-${d.file.processingStatus}-${d.suggestion?.id ?? "none"}`} doc={d} categories={categories} items={items} />
            ))}
          </section>
        ))}
      </main>
    </>
  );
}

function SourceTab({ label, count, href, active }: { label: string; count: number; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-row font-medium ${active ? "bg-accent text-white" : "border border-border text-muted"}`}
    >
      {label}
      <span className={active ? "opacity-70" : "opacity-60"}>{count}</span>
    </Link>
  );
}

/** A heading and the documents under it. */
type Group = [string, DocumentSummary[], null];

function groupByDay(docs: DocumentSummary[]): Group[] {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  const map = new Map<string, DocumentSummary[]>();
  for (const d of docs) {
    const ds = new Date(d.updatedAt).toDateString();
    const label = ds === today ? "Today" : ds === yesterday ? "Yesterday" : new Date(d.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
    map.set(label, [...(map.get(label) ?? []), d]);
  }
  return [...map.entries()].map(([label, group]) => [label, group, null] as Group);
}
