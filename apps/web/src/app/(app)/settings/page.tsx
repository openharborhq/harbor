import type { Metadata } from "next";
import Link from "next/link";
import type { BackupRun, BackupStatus, InviteInfo, OwnerInfo, SessionInfo } from "@harbor/shared";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch, currentUser } from "@/lib/api-server";
import { formatBytes, formatDate, formatRelative, isFuture } from "@/lib/format";
import { initials } from "@/lib/initials";
import { BackupActions } from "./backup-forms";
import { InviteForm, NameForm, PasswordForm, RecoveryCodesForm, RevokeSessionButton } from "./forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [me, owners, invites, sessions, backup, backupRuns] = await Promise.all([
    currentUser(),
    apiFetch<OwnerInfo[]>("/auth/owners"),
    apiFetch<InviteInfo[]>("/auth/invites"),
    apiFetch<SessionInfo[]>("/auth/sessions"),
    apiFetch<BackupStatus>("/backups"),
    apiFetch<BackupRun[]>("/backups/runs"),
  ]);
  const self = owners.find((o) => o.isYou);
  const pending = invites.filter((i) => !i.acceptedAt && isFuture(i.expiresAt));

  return (
    <>
      <TopBar />
      <main className="flex max-w-[1192px] flex-col gap-10 px-14 py-14">
        <div>
          <h1 className="text-title font-bold tracking-snug">Settings</h1>
          <p className="mt-1.5 text-body text-muted">Account, household, mailboxes and backups. The appliance panel arrives with its milestone.</p>
        </div>

        <Panel title="Your account">
          <Row k="Name" v="Shown on your card and beside your name in this household." hint="However you want to be called — it is not used to sign in.">
            <NameForm current={me?.displayName ?? ""} />
          </Row>
          <Row k="Email" v={me?.email ?? ""} />
          <Row k="Two-factor" v={<span className="flex items-center gap-2"><Badge>Required</Badge> Authenticator app</span>} />
          <Row k="Recovery codes" v={`${self?.recoveryCodesLeft ?? 0} of 10 unused`} hint="The only way back in if you lose your authenticator. There is deliberately no email password reset — keep these printed and offline.">
            <RecoveryCodesForm />
          </Row>
          <Row k="Password" v="Change it below" hint="At least 12 characters. Changing it keeps your other sessions signed in.">
            <PasswordForm />
          </Row>
        </Panel>

        <Panel title="Who can sign in" sub="Every account is an owner and sees everything. There are no restricted roles.">
          {owners.map((o) => (
            <div key={o.id} className="flex items-center gap-3 border-t border-border py-3.5 first:border-t-0">
              <div className="flex size-8 items-center justify-center rounded-pill bg-surface text-label font-bold text-muted">{initials(o.displayName)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-row font-medium">
                  {o.displayName}
                  {o.isYou && <Badge>You</Badge>}
                </div>
                <div className="text-small text-muted">
                  {o.email} · {o.totpEnabled ? "2FA on" : "2FA off"} · {o.lastLoginAt ? `last seen ${formatRelative(o.lastLoginAt)}` : "never signed in"}
                </div>
              </div>
            </div>
          ))}
          {pending.map((i) => (
            <div key={i.id} className="flex items-center gap-3 border-t border-border py-3.5 text-row">
              <div className="flex size-8 items-center justify-center rounded-pill border border-dashed border-border-strong text-label text-muted">?</div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{i.email}</div>
                <div className="text-small text-muted">
                  Invited{i.createdBy ? ` by ${i.createdBy}` : ""} · link valid until {formatDate(i.expiresAt)}
                </div>
              </div>
            </div>
          ))}
          <div className="border-t border-border pt-4">
            <InviteForm />
          </div>
        </Panel>

        <Panel title="Email" sub="Connect a mailbox and the vault offers to file the paperwork that arrives in it.">
          <Row
            k="Mailboxes"
            v={<Link href="/settings/mail" className="text-accent underline underline-offset-2">Email connections</Link>}
            hint="Reads over IMAP with an app password you issue. It never deletes, moves or marks anything as read, and nothing is filed until you approve a sender."
          />
        </Panel>

        <Panel
          title="Backups"
          sub="Every night: a database dump and one encrypted snapshot of it and the documents. Once a month the vault restores that snapshot and checks it can read what came back."
        >
          <Row
            k="Destination"
            v={backup.configured ? <code className="text-row">{backup.repository}</code> : "Not configured"}
            hint={
              backup.configured
                ? `Nightly at ${String(backup.backupHour).padStart(2, "0")}:00 · restore test on day ${backup.restoreTestDay} of each month · 30 daily and 12 monthly snapshots kept. Encrypted before it leaves the box; the repository password is in the break-glass envelope.`
                : "Set RESTIC_REPOSITORY on the appliance — a Backblaze B2 bucket, an SFTP host, or a second disk (docs/deploy.md, step 5). Until then a dead disk means the documents are gone."
            }
          />
          <Row k="Last backup" v={<RunLine run={backup.lastBackup} />} />
          <Row
            k="Last restore test"
            v={<RunLine run={backup.lastRestoreTest} />}
            hint="Proof the backup can be read back: the dump loads into a scratch database and twenty random documents decrypt to exactly the bytes that were uploaded."
          >
            <BackupActions configured={backup.configured} running={backup.running?.kind ?? null} />
          </Row>
          {backupRuns.length > 0 && (
            <div className="border-t border-border py-4">
              <h3 className="text-small font-semibold uppercase tracking-label text-muted">Recent runs</h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {backupRuns.slice(0, 8).map((r) => (
                  <li key={r.id} className="flex items-baseline gap-2 text-small">
                    <RunBadge status={r.status} />
                    <span className="w-24 shrink-0">{r.kind === "backup" ? "Backup" : "Restore test"}</span>
                    <span className="shrink-0 text-muted">{formatRelative(r.startedAt)}</span>
                    <span className="min-w-0 truncate text-muted" title={r.summary ?? undefined}>
                      {r.summary}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="Signed-in devices" sub="Sessions last 30 days and renew while in use. Revoke anything you don't recognise.">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border-t border-border py-3 text-row first:border-t-0">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {shortAgent(s.userAgent)}
                  {s.current && (
                    <span className="ml-2">
                      <Badge>This device</Badge>
                    </span>
                  )}
                </div>
                <div className="text-small text-muted">
                  {s.ip ?? "unknown address"} · signed in {formatRelative(s.createdAt)} · expires {formatDate(s.expiresAt)}
                </div>
              </div>
              {!s.current && <RevokeSessionButton id={s.id} />}
            </div>
          ))}
        </Panel>
      </main>
    </>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="max-w-[820px] rounded-lg border border-border">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-section font-semibold tracking-snug">{title}</h2>
        {sub && <p className="mt-0.5 text-small text-muted">{sub}</p>}
      </div>
      <div className="px-5 py-1">{children}</div>
    </section>
  );
}

function Row({ k, v, hint, children }: { k: string; v: React.ReactNode; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-6 border-t border-border py-4 first:border-t-0">
      <div className="w-40 shrink-0 text-row text-muted">{k}</div>
      <div className="min-w-0 flex-1">
        <div className="text-row font-medium">{v}</div>
        {hint && <p className="mt-1 text-small text-muted">{hint}</p>}
        {children && <div className="mt-3">{children}</div>}
      </div>
    </div>
  );
}

/** One run, as Settings summarises it: outcome, when, and the numbers that make it checkable. */
function RunLine({ run }: { run: BackupRun | null }) {
  if (!run) return <span>Never</span>;
  const numbers = [run.documentCount !== null && `${run.documentCount} documents`, run.bytes !== null && formatBytes(run.bytes)].filter(Boolean).join(" · ");
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <RunBadge status={run.status} />
        {run.status === "running" ? `Started ${formatRelative(run.startedAt)}` : formatRelative(run.finishedAt ?? run.startedAt)}
        {numbers && <span className="text-muted">· {numbers}</span>}
      </span>
      {run.status === "failed" && run.summary && <span className="text-small text-danger">{run.summary}</span>}
    </span>
  );
}

function RunBadge({ status }: { status: BackupRun["status"] }) {
  if (status === "ok") return <Badge>OK</Badge>;
  const cls = status === "failed" ? "bg-danger/10 text-danger" : "bg-surface text-muted";
  return <span className={`inline-flex h-5 items-center rounded-sm px-1.5 text-label font-bold uppercase tracking-label ${cls}`}>{status === "failed" ? "Failed" : "Running"}</span>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-5 items-center rounded-sm bg-accent-soft px-1.5 text-label font-bold uppercase tracking-label text-accent">{children}</span>;
}

function shortAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Firefox\/|Edg\/|Chrome\/|Safari\//.exec(ua)?.[0].replace("/", "") ?? "Browser";
  const os = /Macintosh|Windows|iPhone|iPad|Android|Linux/.exec(ua)?.[0] ?? "";
  return `${browser === "Safari" && /Chrome/.test(ua) ? "Chrome" : browser}${os ? ` on ${os === "Macintosh" ? "Mac" : os}` : ""}`;
}
