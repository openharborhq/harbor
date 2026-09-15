import type { Metadata } from "next";
import Link from "next/link";
import type { ShareDelivery, ShareStatus } from "@harbor/shared";
import { EmptyState } from "@/components/EmptyState";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";
import { endingSoon, formatBytes, formatRelative, formatTimeLeft } from "@/lib/format";

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

/**
 * Status, as a phrase rather than a badge.
 *
 * It was an uppercase filled pill — the loudest thing in a row whose point is the share's name,
 * and saying "ACTIVE" beside a column that already said when it ends. What someone scanning this
 * list actually wants is *how long is left*, so the state and the time became one line, with a dot
 * carrying the colour. The dot only reinforces: every state is legible with the colour ignored,
 * which is what a colour-blind reader and a printed page both get.
 */
function status(share: ShareRow): { text: string; dot: string; tone: string } {
  if (share.status === "revoked") return { text: "Withdrawn", dot: "bg-border-strong", tone: "text-muted" };
  if (share.status === "expired") return { text: `Expired ${formatRelative(share.expiresAt)}`, dot: "bg-border-strong", tone: "text-muted" };
  if (endingSoon(share.expiresAt)) return { text: formatTimeLeft(share.expiresAt), dot: "bg-warn", tone: "text-warn font-medium" };
  return { text: formatTimeLeft(share.expiresAt), dot: "bg-label", tone: "text-muted" };
}

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
                  {(() => {
                    const s = status(share);
                    return (
                      <span className="flex w-[170px] shrink-0 items-center gap-2 whitespace-nowrap text-small">
                        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-pill ${s.dot}`} />
                        <span className={`min-w-0 truncate ${s.tone}`}>{s.text}</span>
                      </span>
                    );
                  })()}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
