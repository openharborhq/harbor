import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SHARE_EVENT_LABEL, type ShareAccessEvent, type ShareDelivery, type ShareStatus } from "@harbor/shared";
import { BackLink } from "@/components/BackLink";
import { TopBar } from "@/components/shell/TopBar";
import { ApiError, apiFetch } from "@/lib/api-server";
import { formatBytes, formatRelative } from "@/lib/format";
import { RevokeShare } from "./RevokeShare";

export const metadata: Metadata = { title: "Share" };

interface ShareDetail {
  id: string;
  label: string;
  message: string | null;
  delivery: ShareDelivery;
  fileCount: number;
  byteSize: number;
  expiresAt: string;
  createdAt: string;
  purgedAt: string | null;
  status: ShareStatus;
  files: { documentId: string | null; filename: string; title: string | null; deleted: string | null }[];
  links: {
    id: string;
    recipientLabel: string;
    hasPassword: boolean;
    maxDownloads: number | null;
    downloadCount: number;
    firstOpenedAt: string | null;
    lastDownloadedAt: string | null;
    revokedAt: string | null;
  }[];
  events: {
    id: string;
    shareLinkId: string;
    event: ShareAccessEvent;
    reason: string | null;
    ip: string | null;
    userAgent: string | null;
    createdAt: string;
  }[];
}

/**
 * One share, and what happened to it (spec §10.4, §10.7).
 *
 * The activity list is the part that earns this page. Handing third parties documents about
 * identifiable people is exactly the case where "what left, to whom, and when" is the record you
 * want — and because links are minted per recipient, it can say *which* of them opened it rather
 * than that somebody did.
 */
export default async function SharePage(props: PageProps<"/shares/[id]">) {
  const { id } = await props.params;
  let share: ShareDetail;
  try {
    share = await apiFetch<ShareDetail>(`/shares/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const linkName = new Map(share.links.map((l) => [l.id, l.recipientLabel]));

  return (
    <>
      <TopBar />
      <main className="flex max-w-[900px] flex-col gap-6 px-4 py-8 lg:px-14">
        <div>
          <BackLink href="/shares">Shared</BackLink>
          <h1 className="mt-2 text-title font-bold tracking-tight">{share.label}</h1>
          <p className="mt-1 text-body text-muted">
            {share.fileCount} document{share.fileCount === 1 ? "" : "s"} · {formatBytes(share.byteSize)} ·{" "}
            {share.status === "active"
              ? `available until ${formatRelative(share.expiresAt)}`
              : share.status === "revoked"
                ? "withdrawn"
                : "expired"}
          </p>
          {share.message && <p className="mt-2 max-w-[62ch] text-body">“{share.message}”</p>}
        </div>

        {share.status === "active" ? (
          <RevokeShare id={share.id} />
        ) : (
          <p className="max-w-[62ch] rounded-lg border border-border bg-surface px-4 py-3 text-small text-muted">
            The archive has been destroyed{share.purgedAt ? ` ${formatRelative(share.purgedAt)}` : ""}. This record stays so
            you can still answer what was sent, to whom, and when — but anything already downloaded is with the recipient.
          </p>
        )}

        <section>
          <h2 className="text-section font-semibold tracking-snug">Recipients</h2>
          <ul className="mt-3 flex flex-col divide-y divide-border rounded-card border border-border bg-ground">
            {share.links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <span className="min-w-0 flex-1 basis-[200px]">
                  <span className="block truncate text-row font-semibold">{link.recipientLabel}</span>
                  <span className="block text-small text-muted">
                    {link.hasPassword ? "Password required" : "No password"}
                    {link.maxDownloads ? ` · limit ${link.maxDownloads}` : ""}
                  </span>
                </span>
                <span className="w-[150px] shrink-0 text-small text-muted">
                  {link.firstOpenedAt ? `opened ${formatRelative(link.firstOpenedAt)}` : "not opened"}
                </span>
                <span className="w-[120px] shrink-0 text-small tabular-nums text-muted">
                  {link.downloadCount} download{link.downloadCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-section font-semibold tracking-snug">What was sent</h2>
          <ul className="mt-3 flex flex-col divide-y divide-border rounded-card border border-border bg-ground">
            {share.files.map((file) => (
              <li key={file.filename} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-row">{file.title ?? file.filename}</span>
                <span className="shrink-0 font-mono text-small text-muted">{file.filename}</span>
                {file.documentId && !file.deleted && (
                  <Link href={`/documents/${file.documentId}`} className="shrink-0 text-small text-accent">
                    Open
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-small text-muted">
            The versions that were sealed. Replacing one of these documents since has not changed what the link hands out.
          </p>
        </section>

        <section>
          <h2 className="text-section font-semibold tracking-snug">Activity</h2>
          {share.events.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-border-strong px-4 py-5 text-body text-muted">
              Nothing yet. Opening the link, typing a password and finishing a download all appear here.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-border rounded-card border border-border bg-ground">
              {share.events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                  <span className="w-[150px] shrink-0 text-row">{SHARE_EVENT_LABEL[event.event]}</span>
                  <span className="min-w-0 flex-1 basis-[160px] truncate text-small text-muted">
                    {linkName.get(event.shareLinkId) ?? "a recipient"}
                    {event.reason ? ` · ${event.reason}` : ""}
                  </span>
                  <span className="shrink-0 font-mono text-small text-muted">{event.ip ?? "—"}</span>
                  <span className="w-[110px] shrink-0 text-right text-small text-muted">{formatRelative(event.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
