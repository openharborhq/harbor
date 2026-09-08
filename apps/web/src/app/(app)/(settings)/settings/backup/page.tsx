import type { Metadata } from "next";
import type { BackupRun } from "@harbor/shared";
import { apiFetch } from "@/lib/api-server";
import { formatBytes, formatDate, formatRelative } from "@/lib/format";
import { getBackup } from "../data";
import { BackupActions } from "../backup-forms";
import { Badge, Fact, Facts, GroupLabel, PageHead, Stat, Stats } from "../ui";

export const metadata: Metadata = { title: "Backup · Settings" };

export default async function BackupPage() {
  const [backup, runs] = await Promise.all([getBackup(), apiFetch<BackupRun[]>("/backups/runs").catch(() => [] as BackupRun[])]);

  return (
    <>
      <PageHead title="Backup">
        Every night the vault copies itself somewhere else, encrypted before it leaves the house. Once a month it restores
        that copy and checks it can still read what came back.
      </PageHead>

      <Stats>
        <Stat label="Last backup" value={when(backup.lastBackup)} sub={size(backup.lastBackup)} />
        <Stat label="Last restore test" value={when(backup.lastRestoreTest, "Passed")} sub={backup.lastRestoreTest?.summary ?? "Not run yet"} />
      </Stats>

      <Facts>
        <Fact k="Destination">
          {backup.configured ? <code className="font-mono text-small">{backup.repository}</code> : <span className="text-muted">Not configured — a dead disk would mean the documents are gone.</span>}
        </Fact>
        <Fact k="Schedule">
          {backup.configured
            ? `Nightly at ${String(backup.backupHour).padStart(2, "0")}:00 · restore test on day ${backup.restoreTestDay} of each month`
            : "—"}
        </Fact>
        <Fact k="Keeps">30 nightly, 12 monthly</Fact>
        <Fact k="Deleting">
          <span className="text-muted">
            Not permitted from this box — the key cannot delete, so nothing that gets into this machine can erase your history.
          </span>
        </Fact>
        <Fact k="Configured in">
          <span className="text-muted">
            The environment file on the appliance, <code className="font-mono text-small">harbor config</code>. Setting the destination from here is not built yet.
          </span>
        </Fact>
      </Facts>

      <div className="max-w-[620px] pt-1">
        <BackupActions configured={backup.configured} running={backup.running?.kind ?? null} />
      </div>

      {runs.length > 0 && (
        <section className="flex max-w-[620px] flex-col gap-2.5">
          <GroupLabel>Recent runs</GroupLabel>
          <ul className="flex flex-col gap-1.5">
            {runs.slice(0, 8).map((r) => (
              <li key={r.id} className="flex items-baseline gap-2.5 text-small">
                <RunBadge status={r.status} />
                <span className="w-24 shrink-0">{r.kind === "backup" ? "Backup" : "Restore test"}</span>
                <span className="shrink-0 text-muted">{formatRelative(r.startedAt)}</span>
                <span className="min-w-0 truncate text-muted" title={r.summary ?? undefined}>
                  {r.summary}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** The headline of a run: what happened, and when — "4 hours ago", "Passed 1 Aug", "Never". */
function when(run: BackupRun | null, passed = "Finished"): string {
  if (!run) return "Never";
  if (run.status === "running") return "Running now";
  if (run.status === "failed") return `Failed ${formatRelative(run.finishedAt ?? run.startedAt)}`;
  const at = run.finishedAt ?? run.startedAt;
  return passed === "Passed" ? `Passed ${formatDate(at)}` : formatRelative(at);
}

function size(run: BackupRun | null): string {
  if (!run) return "Nothing has been copied off this box";
  const parts = [run.documentCount !== null && `${run.documentCount} documents`, run.bytes !== null && formatBytes(run.bytes)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : (run.summary ?? "");
}

function RunBadge({ status }: { status: BackupRun["status"] }) {
  if (status === "ok") return <Badge>OK</Badge>;
  return <Badge tone={status === "failed" ? "danger" : "muted"}>{status === "failed" ? "Failed" : "Running"}</Badge>;
}
