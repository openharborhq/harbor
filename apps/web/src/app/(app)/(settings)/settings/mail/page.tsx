import type { Metadata } from "next";
import Link from "next/link";
import { BACKFILL_MONTHS, backfillWindowLabel, type MailConnectionView } from "@harbor/shared";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EmptyState } from "@/components/EmptyState";
import { apiFetch, currentUser } from "@/lib/api-server";
import { formatRelative } from "@/lib/format";
import { PageHead } from "../ui";
import { ConnectForm, ConnectionActions } from "./forms";

export const metadata: Metadata = { title: "Email Ingest · Settings" };

export default async function MailSettingsPage() {
  const [me, connections] = await Promise.all([currentUser(), apiFetch<MailConnectionView[]>("/mail/connections")]);

  // A queued test or backfill answers on the connection row, so poll while one is in flight (§7.10).
  const settling = connections.some((c) => c.backfillStartedAt !== null && c.backfillCompletedAt === null);

  return (
    <>
      <AutoRefresh active={settling} everyMs={4000} />
      <PageHead title="Email Ingest">
        The vault reads a mailbox the way a mail client does — over IMAP, with an app password you issue it. Nothing is
        forwarded to it and nothing is exposed; it connects outward and files what it finds.
      </PageHead>

        {connections.length === 0 ? (
          <section className="max-w-[620px]">
            <EmptyState
              title="No mailbox connected"
              body="Connect the inbox your invoices already arrive in, and the vault will offer to file them. It never deletes, moves or marks anything as read."
            />
          </section>
        ) : (
          <section className="flex max-w-[620px] flex-col gap-4">
            {connections.map((c) => (
              <article key={c.id} className="rounded-lg border border-border">
                <div className="flex items-start gap-4 border-b border-border px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-section font-semibold tracking-snug">{c.label}</h3>
                      <ConnectionStatus connection={c} />
                    </div>
                    <p className="mt-0.5 truncate text-small text-muted">
                      {c.emailAddress} · {c.imapHost}
                      {c.ownerName ? ` · ${c.ownerUserId === me?.id ? "yours" : c.ownerName}` : ""}
                    </p>
                  </div>
                  {c.ownerUserId === me?.id && (
                    <Link href={`/settings/mail/${c.id}`} className="h-9 shrink-0 rounded-md border border-border px-4 text-row font-medium leading-9">
                      Review
                    </Link>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-row">
                  <Field k="Reads">
                    {c.scopeMode === "folder" ? (
                      <>
                        Only <strong className="font-medium">{c.folders.join(", ")}</strong>
                      </>
                    ) : (
                      "Envelopes across the mailbox, bodies only from approved senders"
                    )}
                  </Field>
                  <Field k="Writes">{c.writeBack === "none" ? "Nothing — never marks read, moves or deletes" : c.writeBack}</Field>
                  <Field k="Last checked">{c.lastSyncAt ? formatRelative(c.lastSyncAt) : "not yet"}</Field>
                  <Field k="History">
                    {c.backfillCompletedAt && c.backfillTruncated
                      ? `Stopped at the scan limit before reaching the end of ${c.backfillMonths ? backfillWindowLabel(c.backfillMonths) : "the window"} — older mail in that window was not read. Scanning again reads from the same date and stops in the same place; choose a shorter window instead.`
                      : c.backfillCompletedAt
                      ? `Read back ${c.backfillMonths ? backfillWindowLabel(c.backfillMonths) : "a while"} · scanned ${formatRelative(c.backfillCompletedAt)}`
                      : c.backfillStartedAt
                        ? `Scanning the last ${backfillWindowLabel(c.backfillMonths ?? BACKFILL_MONTHS)}…`
                        : "Not scanned yet"}
                  </Field>
                </dl>

                {c.statusDetail && (
                  <p className="mx-5 mb-4 rounded-md bg-warn-soft px-3 py-2 text-small text-warn">{c.statusDetail}</p>
                )}

                {c.ownerUserId === me?.id && (
                  <div className="border-t border-border px-5 py-3">
                    <ConnectionActions connection={c} />
                  </div>
                )}
              </article>
            ))}
          </section>
        )}

        <section className="max-w-[620px] rounded-lg border border-border">
          <div className="border-b border-border px-5 py-4">
            <h3 className="text-section font-semibold tracking-snug">Connect a mailbox</h3>
            <p className="mt-0.5 text-small text-muted">Type the address and the rest is filled in for you.</p>
          </div>
          <div className="px-5 py-5">
            <ConnectForm />
          </div>
        </section>

        <section className="max-w-[620px] rounded-lg border border-dashed border-border-strong px-5 py-4">
          <h3 className="text-row font-semibold">What this costs you</h3>
          <p className="mt-1 max-w-[640px] text-small text-muted">
            An app password is a broader grant than it looks: on most providers it can read the whole mailbox, and on Gmail it
            can also send. The vault is choosing convenience over the narrowest possible access, and it is worth knowing that.
            To keep it narrow, import the Gmail filter below and let the connection read one label instead of your inbox.
          </p>
          <a href="/api/mail/gmail-filter.xml" className="mt-3 inline-block text-small font-medium text-accent underline underline-offset-2">
            Download the Gmail filter file
          </a>
        </section>
    </>
  );
}

function ConnectionStatus({ connection }: { connection: MailConnectionView }) {
  const tone =
    connection.status === "ok"
      ? "bg-accent-soft text-accent"
      : connection.status === "disabled"
        ? "bg-surface text-muted"
        : "bg-warn-soft text-warn";
  const label =
    connection.status === "ok"
      ? connection.lastOkAt
        ? "Connected"
        : "Not tested yet"
      : connection.status === "auth_failed"
        ? "Password rejected"
        : connection.status === "unreachable"
          ? "Unreachable"
          : "Paused";
  return <span className={`inline-flex h-[22px] shrink-0 items-center rounded-pill px-2.5 text-label font-semibold ${tone}`}>{label}</span>;
}

function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-small text-muted">{k}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
