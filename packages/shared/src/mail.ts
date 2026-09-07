import { z } from "zod/v4";

/**
 * Mail connections (spec §7). The password crosses this boundary exactly once, on create or on an
 * explicit replacement — it is sealed under the KEK on arrival and never appears in any view.
 */

/** What the connect form gets back from one email address (§7.3). */
export const MailAutoconfigResult = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("found"),
    host: z.string(),
    port: z.number().int(),
    username: z.string(),
    providerHint: z.string().nullable(),
    appPasswordUrl: z.string().nullable(),
    appPasswordNote: z.string().nullable(),
    source: z.enum(["builtin", "ispdb", "srv"]),
  }),
  /** Microsoft. Named rather than left to fail later with an auth error (§7.2). */
  z.object({ kind: z.literal("unsupported"), providerHint: z.string(), reason: z.string(), alternative: z.string() }),
  z.object({ kind: z.literal("unknown") }),
]);
export type MailAutoconfigResult = z.infer<typeof MailAutoconfigResult>;

/**
 * How far back the explicit backfill reaches (§7.6). One constant, exported, because the window
 * appears in the scan itself and in four pieces of user-facing copy — and a button that promises
 * a different window from the one the scan uses is worse than no button.
 */
export const BACKFILL_MONTHS = 2;
export const BACKFILL_WINDOW = `${BACKFILL_MONTHS} months`;

/**
 * The windows offered when starting a scan, and the reason the scan is staged at all.
 *
 * A mailbox of a few hundred thousand messages holds paperwork in the low thousands, and dropping
 * all of it into the Inbox at once is not a queue, it is a pile. Widening in stages — two months,
 * mute the obvious senders, six, mute, two years — makes each pass smaller than the last, because
 * the mutes carry forward and the noisiest senders are gone before the deep history is read.
 */
export const BACKFILL_WINDOWS = [2, 6, 12, 24, 60] as const;

export function backfillWindowLabel(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? "1 year" : `${years} years`;
  }
  return `${months} months`;
}

/** Body of a scan request. Absent months means the default window. */
export const BackfillRequest = z.object({
  months: z.number().int().min(1).max(120).default(BACKFILL_MONTHS),
});
export type BackfillRequest = z.infer<typeof BackfillRequest>;

export const MailScopeMode = z.enum(["folder", "senders"]);
export type MailScopeMode = z.infer<typeof MailScopeMode>;

export const CreateMailConnection = z.object({
  label: z.string().min(1).max(60),
  emailAddress: z.string().email(),
  imapHost: z.string().min(1).max(255),
  imapPort: z.number().int().min(1).max(65535).default(993),
  imapUsername: z.string().min(1).max(255),
  password: z.string().min(1).max(512),
  scopeMode: MailScopeMode.default("folder"),
  folders: z.array(z.string().min(1)).max(20).default(["INBOX"]),
  providerHint: z.string().max(60).nullable().default(null),
  /**
   * Only a dedicated forwarding mailbox may set this. On a connected inbox it stays null and the
   * vault never deletes mail it does not own (§7.8) — the API rejects a value here for one.
   */
  retentionDays: z.number().int().min(1).max(3650).nullable().default(null),
  isForwardingMailbox: z.boolean().default(false),
});
export type CreateMailConnection = z.infer<typeof CreateMailConnection>;

export const UpdateMailConnection = z.object({
  label: z.string().min(1).max(60).optional(),
  /** Replacing a revoked app password, the one time a secret crosses this boundary again. */
  password: z.string().min(1).max(512).optional(),
  scopeMode: MailScopeMode.optional(),
  folders: z.array(z.string().min(1)).max(20).optional(),
  writeBack: z.enum(["none", "seen", "flag"]).optional(),
  status: z.enum(["ok", "disabled"]).optional(),
});
export type UpdateMailConnection = z.infer<typeof UpdateMailConnection>;

/** Everything the settings screen shows. Conspicuously not the password (§7.10). */
export const MailConnectionView = z.object({
  id: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  ownerName: z.string().nullable(),
  label: z.string(),
  emailAddress: z.string(),
  providerHint: z.string().nullable(),
  imapHost: z.string(),
  imapPort: z.number().int(),
  imapUsername: z.string(),
  scopeMode: MailScopeMode,
  folders: z.array(z.string()),
  discoveredFolders: z.array(z.string()),
  writeBack: z.enum(["none", "seen", "flag"]),
  retentionDays: z.number().int().nullable(),
  isForwardingMailbox: z.boolean(),
  backfillStartedAt: z.string().datetime().nullable(),
  backfillCompletedAt: z.string().datetime().nullable(),
  /** How far back the last completed scan reached, so the next stage can offer to go further. */
  backfillMonths: z.number().int().nullable(),
  status: z.enum(["ok", "auth_failed", "unreachable", "disabled"]),
  statusDetail: z.string().nullable(),
  lastOkAt: z.string().datetime().nullable(),
  lastSyncAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type MailConnectionView = z.infer<typeof MailConnectionView>;

/**
 * Testing happens by connection id, never by posting credentials to be tried (§7.3).
 *
 * The connection is created sealed first and tested afterwards. That ordering exists so a
 * plaintext app password is never written to the job queue on its way to `mailfetch` — the only
 * process that may unseal one.
 */

/**
 * A test is asynchronous and its answer is the connection's own status — `status`, `statusDetail`
 * and `discoveredFolders` on the view above. There is no separate result type on purpose: §7.10
 * requires connection health to be visible at all times, and a one-off test response that
 * disagreed with the stored status would be a second source of truth for the same question.
 */

/** One row of the backfill review — a sender, not a message (§7.6). */
export const BackfillCandidateSender = z.object({
  fromAddr: z.string(),
  messages: z.number().int(),
  /** How many arrived with something filable attached, i.e. tier 0. */
  withAttachments: z.number().int(),
  lastSeen: z.string().datetime(),
  sampleSubject: z.string().nullable(),
  /** The rule already in force for this sender, if any. */
  decision: z.enum(["file", "ignore", "hold"]).nullable(),
});
export type BackfillCandidateSender = z.infer<typeof BackfillCandidateSender>;

/** Bulk approval, the backfill review's only action. Defaults ride along and become the rule. */
export const ApproveSenders = z.object({
  fromAddrs: z.array(z.string().email()).min(1).max(200),
  decision: z.enum(["file", "ignore", "hold"]),
  defaultCategorySlug: z.string().max(120).nullable().default(null),
  defaultItemLabels: z.array(z.string().max(80)).max(10).default([]),
  defaultTags: z.array(z.string().max(40)).max(10).default([]),
  learnedFrom: z.enum(["backfill", "manual", "accepted_suggestion"]).default("backfill"),
});
export type ApproveSenders = z.infer<typeof ApproveSenders>;

export const MailSenderView = z.object({
  id: z.string().uuid(),
  fromAddr: z.string(),
  decision: z.enum(["file", "ignore", "hold"]),
  defaultCategorySlug: z.string().nullable(),
  defaultItemLabels: z.array(z.string()),
  defaultTags: z.array(z.string()),
  learnedFrom: z.enum(["backfill", "manual", "accepted_suggestion"]),
  updatedAt: z.string().datetime(),
});
export type MailSenderView = z.infer<typeof MailSenderView>;

/** A message waiting on a decision. Visible only to the connection's owner (§7.7). */
export const HeldMessage = z.object({
  id: z.string().uuid(),
  fromAddr: z.string(),
  subject: z.string().nullable(),
  folder: z.string(),
  tier: z.number().int().nullable(),
  heldReason: z.string().nullable(),
  receivedAt: z.string().datetime(),
});
export type HeldMessage = z.infer<typeof HeldMessage>;

/**
 * A sender with documents sitting in the Inbox (§7.6). The unit of bulk triage: 1,800 documents
 * is not a decision anyone can make, and the same twenty senders produce most of them.
 */
export const InboxSender = z.object({
  fromAddr: z.string(),
  connectionId: z.string().uuid(),
  documentIds: z.array(z.string().uuid()),
  /** Newest first, for the group heading. */
  latestAt: z.string().datetime(),
  muted: z.boolean(),
});
export type InboxSender = z.infer<typeof InboxSender>;

/** "Never file from this sender." Prospective (a rule) and retroactive (what they already sent). */
export const MuteSenders = z.object({
  fromAddrs: z.array(z.string().min(1)).min(1).max(200),
  /** Soft-delete what they have already filed. Recoverable from Recently deleted either way. */
  deleteFiled: z.boolean().default(true),
});
export type MuteSenders = z.infer<typeof MuteSenders>;

export const MuteResult = z.object({ muted: z.number().int(), deleted: z.number().int() });
export type MuteResult = z.infer<typeof MuteResult>;
