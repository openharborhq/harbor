import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth";

export interface FolderCursor {
  uidValidity: number;
  lastUid: number;
}

/**
 * A mailbox the vault reads (spec §7). Either a dedicated forwarding address or an inbox the
 * owner already uses — the difference is `scopeMode` and `retentionDays`, not a separate table.
 *
 * Always an app password: there is no OAuth in v1 and no column anticipating one (§7.2).
 * `secretEnc` is sealed under the KEK the same way `users.totpSecretEnc` is — one text column
 * carrying its own key version, not a DEK-style split (§3.3).
 */
export const mailConnections = pgTable(
  "mail_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Unfiled mail from this connection is visible only to its owner (§7.7). */
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    emailAddress: text("email_address").notNull(),
    /**
     * Which of §7.1's two models this is. `forwarding` is a dedicated address the vault owns, and
     * only it may set `retentionDays`; `inbox` is a mailbox the owner already uses, where deleting
     * mail is not the vault's to do (§7.8).
     */
    kind: text("kind", { enum: ["forwarding", "inbox"] }).notNull().default("inbox"),
    /** Which autodiscover preset matched, for the settings UI. Never load-bearing. */
    providerHint: text("provider_hint"),
    imapHost: text("imap_host").notNull(),
    imapPort: integer("imap_port").notNull().default(993),
    imapUsername: text("imap_username").notNull(),
    secretEnc: text("secret_enc").notNull(),
    /** `folder` opens only `folders`; `senders` reads envelopes mailbox-wide (§7.4). */
    scopeMode: text("scope_mode", { enum: ["folder", "senders"] }).notNull().default("folder"),
    folders: text("folders").array().notNull().default(["INBOX"]),
    /** What the last successful test saw, so the folder picker offers real names (§7.3). */
    discoveredFolders: text("discovered_folders").array().notNull().default([]),
    writeBack: text("write_back", { enum: ["none", "seen", "flag"] }).notNull().default("none"),
    /** NULL on a connected inbox — the vault never deletes from a mailbox it does not own (§7.8). */
    retentionDays: integer("retention_days"),
    backfillStartedAt: timestamp("backfill_started_at", { withTimezone: true }),
    backfillCompletedAt: timestamp("backfill_completed_at", { withTimezone: true }),
    /**
     * The last backfill stopped at the message cap instead of reaching the end of its window, so
     * older mail in that window was never looked at. Re-running does not help — it reads from the
     * same date and stops in the same place — so the settings page says to narrow the window.
     */
    backfillTruncated: boolean("backfill_truncated").notNull().default(false),
    /** Window of the last scan, in months — what makes "you have read 6 months; read 24?" possible. */
    backfillMonths: integer("backfill_months"),
    status: text("status", { enum: ["ok", "auth_failed", "unreachable", "disabled"] }).notNull().default("ok"),
    statusDetail: text("status_detail"),
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    /**
     * folder name → where the last pass got to. UIDVALIDITY changing means the server renumbered,
     * so the cursor is thrown away and the folder is re-read against `email_ingest_log` by
     * Message-ID rather than re-ingested (§7.5).
     */
    uidvalidity: jsonb("uidvalidity").$type<Record<string, FolderCursor>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mail_connections_owner_idx").on(t.ownerUserId)],
);

/**
 * What to do with mail from one address, learned by approving senders in the backfill (§7.6).
 *
 * Defaults are stored as slugs and labels rather than ids, exactly as `suggestions.payload` is:
 * they are resolved against the current vocabulary when the rule fires and unknown values are
 * dropped, so deleting a category or an item can never strand a rule pointing at nothing.
 */
export const mailSenders = pgTable(
  "mail_senders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id").notNull().references(() => mailConnections.id, { onDelete: "cascade" }),
    fromAddr: text("from_addr").notNull(),
    decision: text("decision", { enum: ["file", "ignore", "hold"] }).notNull().default("hold"),
    defaultCategorySlug: text("default_category_slug"),
    defaultItemLabels: text("default_item_labels").array().notNull().default([]),
    defaultTags: text("default_tags").array().notNull().default([]),
    learnedFrom: text("learned_from", { enum: ["backfill", "manual", "accepted_suggestion"] }).notNull().default("manual"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mail_senders_conn_addr_idx").on(t.connectionId, t.fromAddr)],
);

/**
 * Every message the vault has looked at and what came of it (spec §1, §7). Held mail is never
 * dropped silently — it sits here with a reason until someone decides.
 *
 * `rawBlobKey` stays NULL on a connected inbox: the message is still in the mailbox, so copying
 * private correspondence into the vault (and into the backups) would buy nothing (§7.8).
 */
export const emailIngestLog = pgTable(
  "email_ingest_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id").notNull().references(() => mailConnections.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    imapUid: integer("imap_uid"),
    folder: text("folder").notNull().default("INBOX"),
    /** Which detection tier accepted it, 0–2; NULL when nothing did (§7.5). */
    tier: integer("tier"),
    fromAddr: text("from_addr").notNull(),
    subject: text("subject"),
    status: text("status", { enum: ["accepted", "held", "rejected"] }).notNull(),
    /** Why it is waiting: "unknown sender", "attachment over 25 MB", "10 attachment limit". */
    heldReason: text("held_reason"),
    rawBlobKey: text("raw_blob_key"),
    documentIds: uuid("document_ids").array().notNull().default([]),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The idempotency key: a message is considered once, however often it is seen (§7.5).
    uniqueIndex("email_ingest_message_idx").on(t.connectionId, t.messageId),
    index("email_ingest_status_idx").on(t.connectionId, t.status),
  ],
);
