import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { backfillWindowLabel, type BackfillCandidateSender, type Category, type HeldMessage, type MailConnectionView } from "@harbor/shared";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EmptyState } from "@/components/EmptyState";
import { BackLink } from "@/components/BackLink";
import { ApiError, apiFetch } from "@/lib/api-server";
import { formatRelative } from "@/lib/format";
import { SenderReview } from "./review";

export const metadata: Metadata = { title: "Review senders · Settings" };

export default async function MailReviewPage(props: PageProps<"/settings/mail/[id]">) {
  const { id } = await props.params;

  const connections = await apiFetch<MailConnectionView[]>("/mail/connections");
  const connection = connections.find((c) => c.id === id);
  if (!connection) notFound();

  // Candidates and held mail are owner-only (§7.7); a 403 here means someone else's mailbox.
  let candidates: BackfillCandidateSender[] = [];
  let held: HeldMessage[] = [];
  let forbidden = false;
  try {
    [candidates, held] = await Promise.all([
      apiFetch<BackfillCandidateSender[]>(`/mail/connections/${id}/candidates`),
      apiFetch<HeldMessage[]>(`/mail/connections/${id}/held`),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) forbidden = true;
    else throw err;
  }

  const categories = await apiFetch<Category[]>("/categories");
  const scanning = connection.backfillStartedAt !== null && connection.backfillCompletedAt === null;
  const undecided = candidates.filter((c) => c.decision === null);
  const messages = candidates.reduce((n, c) => n + c.messages, 0);

  return (
    <>
      <AutoRefresh active={scanning} everyMs={4000} />
      <header className="flex max-w-[620px] flex-col gap-2.5">
        <BackLink href="/settings/mail" className="text-small text-muted hover:text-text">
          ← Email Ingest
        </BackLink>
        <h1 className="text-[26px] font-bold leading-8 tracking-snug">{connection.label}</h1>
        <p className="text-body text-muted">
            {forbidden
              ? "This mailbox belongs to someone else in the household. Mail that has not been filed yet is theirs to review — once a document is filed, everyone sees it."
              : scanning
                ? `Scanning the last ${backfillWindowLabel(connection.backfillMonths ?? 2)}. Senders will appear here as they are found.`
                : candidates.length > 0
                  ? `${messages} ${messages === 1 ? "message" : "messages"} from ${candidates.length} ${candidates.length === 1 ? "sender" : "senders"}. Approve a sender and everything they have sent is filed — and everything they send next.`
                  : "Nothing is waiting on you."}
        </p>
      </header>

        {forbidden ? null : candidates.length === 0 && held.length === 0 ? (
          <section className="max-w-[880px]">
            <EmptyState
              title={connection.backfillCompletedAt ? "Nothing waiting" : "Nothing found yet"}
              body={
                connection.backfillCompletedAt
                  ? "Every sender has been decided. New mail from an approved sender files itself; anything from someone new will appear here."
                  : "Run a scan on the connection to see who has been sending you paperwork."
              }
              action="Back to connections"
              href="/settings/mail"
            />
          </section>
        ) : (
          <SenderReview connectionId={id} candidates={candidates} categories={withPaths(categories)} />
        )}

        {!forbidden && held.length > 0 && (
          <section className="max-w-[880px] rounded-lg border border-border">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-section font-semibold tracking-snug">Waiting</h3>
              <p className="mt-0.5 text-small text-muted">
                Only you can see this — it is mail, not a document yet. It stays in your mailbox either way.
              </p>
            </div>
            <ul className="px-5 py-1">
              {held.slice(0, 50).map((m) => (
                <li key={m.id} className="flex gap-4 border-t border-border py-3 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-row font-medium">{m.subject ?? "(no subject)"}</div>
                    <div className="truncate text-small text-muted">
                      {m.fromAddr} · {formatRelative(m.receivedAt)} · {m.folder}
                    </div>
                  </div>
                  {m.heldReason && <div className="w-64 shrink-0 text-small text-muted">{m.heldReason}</div>}
                </li>
              ))}
            </ul>
            {held.length > 50 && <p className="px-5 pb-4 text-small text-muted">and {held.length - 50} more</p>}
          </section>
        )}

        {undecided.length > 0 && (
          <p className="max-w-[720px] text-small text-muted">
            Nothing is filed until you decide. Approving a sender files what they have already sent as well as what comes next;
            ignoring one clears their mail from this list without touching the mailbox.
          </p>
        )}
    </>
  );
}

/** Categories are two levels deep (§1); the picker shows "Real Estate › Utilities", not "Utilities". */
function withPaths(categories: Category[]): { slug: string; path: string }[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return categories
    .map((c) => {
      const parent = c.parentId ? byId.get(c.parentId) : null;
      return { slug: c.slug, path: parent ? `${parent.name} › ${c.name}` : c.name };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}
