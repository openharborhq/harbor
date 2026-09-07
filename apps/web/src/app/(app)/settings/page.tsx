import type { Metadata } from "next";
import type { InviteInfo, OwnerInfo, SessionInfo } from "@trustworthier/shared";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch, currentUser } from "@/lib/api-server";
import { formatDate, formatRelative, isFuture } from "@/lib/format";
import { InviteForm, PasswordForm, RecoveryCodesForm, RevokeSessionButton } from "./forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [me, owners, invites, sessions] = await Promise.all([
    currentUser(),
    apiFetch<OwnerInfo[]>("/auth/owners"),
    apiFetch<InviteInfo[]>("/auth/invites"),
    apiFetch<SessionInfo[]>("/auth/sessions"),
  ]);
  const self = owners.find((o) => o.isYou);
  const pending = invites.filter((i) => !i.acceptedAt && isFuture(i.expiresAt));

  return (
    <>
      <TopBar />
      <main className="flex max-w-[1192px] flex-col gap-10 px-14 py-14">
        <div>
          <h1 className="text-title font-bold tracking-snug">Settings</h1>
          <p className="mt-1.5 text-body text-muted">Account and household. Backups, email forwarding and the appliance panel arrive with their milestones.</p>
        </div>

        <Panel title="Your account">
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
              <div className="flex size-8 items-center justify-center rounded-pill bg-surface text-label font-bold text-muted">{o.displayName.slice(0, 2).toUpperCase()}</div>
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

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-5 items-center rounded-sm bg-accent-soft px-1.5 text-label font-bold uppercase tracking-label text-accent">{children}</span>;
}

function shortAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Firefox\/|Edg\/|Chrome\/|Safari\//.exec(ua)?.[0].replace("/", "") ?? "Browser";
  const os = /Macintosh|Windows|iPhone|iPad|Android|Linux/.exec(ua)?.[0] ?? "";
  return `${browser === "Safari" && /Chrome/.test(ua) ? "Chrome" : browser}${os ? ` on ${os === "Macintosh" ? "Mac" : os}` : ""}`;
}
