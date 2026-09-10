import type { Metadata } from "next";
import Link from "next/link";
import { looksLikeClutter, type Category, type DocumentSummary, type Item, type MailConnectionView } from "@harbor/shared";
import { AcceptAll } from "@/components/AcceptAll";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DeleteClutter } from "@/components/DeleteClutter";
import { InboxCard } from "@/components/InboxCard";
import { isProcessing } from "@/components/StatusPill";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage(props: PageProps<"/inbox">) {
  const sp = await props.searchParams;
  const source = sp.source === "email" || sp.source === "upload" ? sp.source : null;
  const clutterView = sp.show === "not-paperwork";

  // Counts come from the unfiltered list so the tabs can show them; the filter is applied here
  // rather than in a second request, because the Inbox is small by construction.
  const [all, categories, items, connections] = await Promise.all([
    apiFetch<DocumentSummary[]>("/documents?inbox=1"),
    apiFetch<Category[]>("/categories"),
    apiFetch<Item[]>("/items"),
    // Only used to explain an empty Inbox, so a mail service that is down must not empty the page.
    apiFetch<MailConnectionView[]>("/mail/connections").catch(() => [] as MailConnectionView[]),
  ]);
  /**
   * §5's `keep`, applied. Attachments the model judged not to be paperwork are held back from the
   * queue rather than deleted or hidden: they are one link away, counted, and deletable in bulk.
   * Everything without a suggestion stays in the main list — silence is not a judgement.
   */
  const clutter = all.filter(looksLikeClutter);
  const keepers = all.filter((d) => !looksLikeClutter(d));
  const pool = clutterView ? clutter : keepers;
  const counts = { all: keepers.length, upload: keepers.filter((d) => d.source === "upload").length, email: keepers.filter((d) => d.source === "email").length };
  const docs = source ? pool.filter((d) => d.source === source) : pool;
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
            <h1 className="text-title font-bold tracking-snug">{clutterView ? "Probably not paperwork" : "Inbox"}</h1>
            <p className="mt-1.5 text-body text-muted">
              {clutterView
                ? `${docs.length} attachment${docs.length === 1 ? "" : "s"} that arrived by email and ${docs.length === 1 ? "does" : "do"} not look like something to keep — leaflets, newsletters, notices. Open any to check; deleting is reversible.`
                : docs.length === 0
                  ? "Nothing to review."
                  : `${docs.length} document${docs.length === 1 ? "" : "s"} to review${suggested ? ` · ${suggested} ${suggested === 1 ? "has" : "have"} a suggested filing location` : ""}${processing ? ` · ${processing} still being read` : ""}`}
            </p>
          </div>
          {clutterView ? <DeleteClutter ids={docs.map((d) => d.id)} /> : docs.length > 0 && <AcceptAll eligible={eligible} />}
        </div>

        {/* Two streams arrive here and they are reviewed differently: a scan you just made needs
            a glance, a fortnight of emailed invoices needs a sitting. Splitting them is the
            difference between the Inbox being a queue and being a pile. */}
        {clutterView && (
          <p className="-mt-4 text-row">
            <Link href="/inbox" className="font-medium text-accent">
              Back to the Inbox
            </Link>
          </p>
        )}

        {!clutterView && counts.email > 0 && counts.upload > 0 && (
          <nav className="-mt-4 flex gap-1.5">
            <SourceTab label="Everything" count={counts.all} href="/inbox" active={source === null} />
            <SourceTab label="Uploaded" count={counts.upload} href="/inbox?source=upload" active={source === "upload"} />
            <SourceTab label="From email" count={counts.email} href="/inbox?source=email" active={source === "email"} />
          </nav>
        )}

        {docs.length === 0 && <EmptyInbox source={source} connections={connections} />}

        {!clutterView && clutter.length > 0 && (
          <p className="-mt-4 text-row text-muted">
            {clutter.length} emailed attachment{clutter.length === 1 ? "" : "s"} {clutter.length === 1 ? "does" : "do"} not look like paperwork and {clutter.length === 1 ? "is" : "are"} held back.{" "}
            <Link href="/inbox?show=not-paperwork" className="font-medium text-accent">
              Review {clutter.length === 1 ? "it" : "them"}
            </Link>
          </p>
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

/**
 * An empty Inbox means two opposite things and the difference matters. With nothing connected it
 * is a vault waiting to be given something. With a mailbox connected it is a queue that is up to
 * date, and the honest thing to say is that the watching is happening without you.
 *
 * A connection that is not `ok` is called out rather than glossed: the sweep skips it entirely, so
 * "we are watching" would be untrue exactly when it matters most.
 */
function EmptyInbox({ source, connections }: { source: "email" | "upload" | null; connections: MailConnectionView[] }) {
  const watching = connections.filter((c) => c.status === "ok");
  const ailing = connections.filter((c) => c.status !== "ok");
  const names = watching.map((c) => c.label).join(", ");

  return (
    <div className="rounded-card border border-dashed border-border-strong p-12 text-center">
      <p className="text-section font-semibold tracking-snug">
        {source === "email" ? "Nothing from email to review" : source === "upload" ? "Nothing uploaded to review" : "Your Inbox is empty"}
      </p>
      <p className="mx-auto mt-2 max-w-[520px] text-body text-muted">
        {source === "upload" ? (
          <>
            Nothing you uploaded is waiting.{" "}
            <Link href="/inbox" className="font-medium text-accent">
              See everything in the Inbox
            </Link>
          </>
        ) : watching.length > 0 ? (
          <>
            {names} {watching.length === 1 ? "is" : "are"} being watched. Harbor checks every few minutes and files what
            looks like paperwork here, so there is nothing to do but come back — or{" "}
            <Link href="/add" className="font-medium text-accent">
              add something yourself
            </Link>
            .
          </>
        ) : source === "email" ? (
          <>
            No mailbox is connected yet.{" "}
            <Link href="/settings/mail" className="font-medium text-accent">
              Connect one
            </Link>{" "}
            and its paperwork will arrive here on its own.
          </>
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
      {ailing.length > 0 && (
        <p className="mx-auto mt-3 max-w-[520px] rounded-md bg-warn-soft px-3 py-2 text-small text-warn">
          {ailing.map((c) => c.label).join(", ")} {ailing.length === 1 ? "is" : "are"} not connected, so nothing is being
          read from {ailing.length === 1 ? "it" : "them"}.{" "}
          <Link href="/settings/mail" className="font-semibold underline underline-offset-2">
            Fix it in Email Ingest
          </Link>
        </p>
      )}
    </div>
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
