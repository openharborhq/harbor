import type { Metadata } from "next";
import { initials } from "@/lib/initials";
import { formatDate, formatRelative, isFuture } from "@/lib/format";
import { getInvites, getOwners } from "../data";
import { InviteForm } from "../forms";
import { Badge, Field, PageHead, Row, Rows } from "../ui";

export const metadata: Metadata = { title: "Users · Settings" };

export default async function UsersPage() {
  const [owners, invites] = await Promise.all([getOwners(), getInvites()]);
  const pending = invites.filter((i) => !i.acceptedAt && isFuture(i.expiresAt));

  return (
    <>
      <PageHead title="Users">
        Everyone who can sign in. Every account is an owner and sees everything in the vault — there are no restricted
        roles, because a household document is either yours to see or it should not be in here.
      </PageHead>

      <Rows>
        {owners.map((o) => (
          <Row key={o.id}>
            <div className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-surface text-label font-bold text-muted">{initials(o.displayName)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-row font-medium">
                {o.displayName}
                {o.isYou && <Badge>You</Badge>}
              </div>
              <div className="truncate text-small text-muted">
                {o.email} · {o.totpEnabled ? "2FA on" : "2FA off"} · {o.lastLoginAt ? `last seen ${formatRelative(o.lastLoginAt)}` : "never signed in"}
              </div>
            </div>
          </Row>
        ))}
        {pending.map((i) => (
          <Row key={i.id}>
            <div className="flex size-8 shrink-0 items-center justify-center rounded-pill border border-dashed border-border-strong text-label text-muted">?</div>
            <div className="min-w-0 flex-1">
              <div className="text-row font-medium">{i.email}</div>
              <div className="truncate text-small text-muted">
                Invited{i.createdBy ? ` by ${i.createdBy}` : ""} · link valid until {formatDate(i.expiresAt)}
              </div>
            </div>
            <Badge tone="muted">Pending</Badge>
          </Row>
        ))}
      </Rows>

      <Field
        label="Invite someone"
        hint="Creates a link that works once and expires in 48 hours. You send it to them yourself — the vault has no outbound mail, so nothing about this leaves the house."
      >
        <InviteForm />
      </Field>
    </>
  );
}
