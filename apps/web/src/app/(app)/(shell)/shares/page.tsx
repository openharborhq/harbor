import type { Metadata } from "next";
import Link from "next/link";
import type { ShareDelivery, ShareStatus } from "@harbor/shared";
import { EmptyState } from "@/components/EmptyState";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";
import { formatBytes, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Shared" };

interface ShareRow {
  id: string;
  label: string;
  delivery: ShareDelivery;
  fileCount: number;
  byteSize: number;
  expiresAt: string;
  createdAt: string;
  createdBy: string | null;
  recipientCount: number;
  downloadCount: number;
  status: ShareStatus;
}

const STATUS_STYLE: Record<ShareStatus, string> = {
  active: "border-label/30 bg-label-soft text-label",
  expired: "border-border bg-surface text-muted",
  revoked: "border-border bg-surface text-muted",
};

/**
 * What has left the house, and what is still reachable (spec §10.7).
 *
 * Expired and revoked shares stay in the list rather than disappearing: "what did we send the
 * Steuerberater in 2025" is the question this page has to keep answering long after the bundle
 * itself has been destroyed.
 */
export default async function SharesPage() {
  const shares = await apiFetch<ShareRow[]>("/shares").catch(() => [] as ShareRow[]);
  const live = shares.filter((s) => s.status === "active");

  return (
    <>
      <TopBar />
      <main className="flex flex-col gap-6 px-4 py-8 lg:px-14">
        <div>
          <h1 className="text-title font-bold tracking-tight">Shared</h1>
          <p className="mt-1 max-w-[64ch] text-body text-muted">
            {live.length > 0
              ? `${live.length} share${live.length === 1 ? "" : "s"} can still be opened. Everything else is kept as a record.`
              : "Documents you have handed to someone outside the house."}
          </p>
        </div>

        {shares.length === 0 ? (
          <EmptyState
            title="Nothing shared yet"
            body="Add documents to a share from a search, an item, or the inbox, and they gather into a basket at the bottom of the screen."
          />
        ) : (
          <ul className="flex max-w-[900px] flex-col divide-y divide-border rounded-card border border-border bg-ground">
            {shares.map((share) => (
              <li key={share.id}>
                <Link href={`/shares/${share.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface">
                  <span className="min-w-0 flex-1 basis-[240px]">
                    <span className="block truncate text-row font-semibold">{share.label}</span>
                    <span className="block text-small text-muted">
                      {share.fileCount} document{share.fileCount === 1 ? "" : "s"} · {formatBytes(share.byteSize)} ·{" "}
                      {share.recipientCount} recipient{share.recipientCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="w-[110px] shrink-0 text-small tabular-nums text-muted">
                    {share.downloadCount} download{share.downloadCount === 1 ? "" : "s"}
                  </span>
                  <span className="w-[130px] shrink-0 text-small text-muted">
                    {share.status === "active" ? `until ${formatRelative(share.expiresAt)}` : formatRelative(share.createdAt)}
                  </span>
                  <span
                    className={`shrink-0 rounded-pill border px-2 py-0.5 text-label font-bold uppercase tracking-label ${STATUS_STYLE[share.status]}`}
                  >
                    {share.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
