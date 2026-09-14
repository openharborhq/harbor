import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, bigint, timestamp, customType, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { documents, documentFiles } from "./documents";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * Handing documents to an outsider — the accountant, the insurer, the landlord (spec §10).
 *
 * A share is a **build, not a pointer**. Creating one decrypts the chosen file versions, packs
 * them into one zip and re-encrypts that archive under a key minted for this share alone. Nothing
 * downstream — the doorman container, an object store — ever holds the KEK, so a compromise of
 * whatever serves the bytes exposes only what was already being handed out.
 *
 * Two consequences are in the columns. `sealedAt` and the wrapped key make the bundle a real
 * artifact with a lifetime of its own, ended by `purgedAt`; and because §10.2 pins
 * `share_files.document_file_id` to a *version*, replacing a document tomorrow does not change
 * what a link already sent hands out.
 */
export const shares = pgTable(
  "shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** What the owner calls it — "2025 taxes for Herr Brand". Never shown to a recipient. */
    label: text("label").notNull(),
    /** Optional note rendered on the landing page, which a recipient does see. */
    message: text("message"),
    /**
     * Where the sealed bundle is served from. The seal is byte-identical either way; this decides
     * only what happens next, which is what keeps the two sinks swappable (§10.10).
     *
     * `doorman` — written to /data/shares and served by the harbor-share container over Funnel.
     * `bucket`  — pushed to the owner's own S3-compatible store; the box is never reachable.
     */
    delivery: text("delivery", { enum: ["doorman", "bucket"] }).notNull(),
    /** Object prefix in the share bucket, `bucket` delivery only. NULL for `doorman`. */
    objectKey: text("object_key"),
    /**
     * The size the bundle was padded up to. The store and the doorman both see sizes, and an
     * unpadded one separates a passport scan from a year of tax paperwork perfectly well (§10.10).
     */
    paddedSize: bigint("padded_size", { mode: "number" }),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    fileCount: integer("file_count").notNull(),
    bundleSha256: text("bundle_sha256"),
    /**
     * The per-share key, wrapped by the KEK — the vault's own copy, so a bundle can be re-sealed
     * without going back to every DEK. The copy the doorman uses lives beside the bundle on disk;
     * the copy a `bucket` recipient uses is in the link fragment and was never stored anywhere.
     */
    shareKeyWrapped: bytea("share_key_wrapped").notNull(),
    iv: bytea("iv").notNull(),
    authTag: bytea("auth_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    /** Share-wide expiry. A link may narrow it; nothing may widen it. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    sealedAt: timestamp("sealed_at", { withTimezone: true }),
    /**
     * When the bundle was destroyed, by expiry or by revoke. The row and its audit trail outlive
     * the bytes on purpose: "what did we send the Steuerberater in 2025" has to stay answerable
     * long after the link is dead.
     */
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The purge sweep's own query: sealed, not yet purged, and out of time.
    index("shares_purge_idx").on(t.expiresAt).where(sql`purged_at is null`),
    index("shares_created_idx").on(t.createdAt),
  ],
);

/**
 * The documents in one share, pinned to the file *version* that was sealed.
 *
 * `filenameInBundle` is what the recipient reads, so it is sanitised and de-duplicated at seal
 * time rather than trusted from `original_filename` — two files called "Rechnung.pdf" is the
 * ordinary case, not the edge one.
 */
export const shareFiles = pgTable(
  "share_files",
  {
    shareId: uuid("share_id")
      .notNull()
      .references(() => shares.id, { onDelete: "cascade" }),
    /** Kept for "what have we ever sent about this document?", so no cascade from the document. */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    documentFileId: uuid("document_file_id").references(() => documentFiles.id, { onDelete: "set null" }),
    filenameInBundle: text("filename_in_bundle").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("share_files_share_idx").on(t.shareId), index("share_files_document_idx").on(t.documentId)],
);

/**
 * One link per recipient, never one link with a password (spec §10.4).
 *
 * That is what makes the audit trail answer "did the accountant open it?" rather than "did
 * somebody?", and what lets one recipient be cut off without breaking the other. The name is a
 * label and not verified identity — Harbor sends no mail, so it has no channel to prove who is on
 * the other end, and the interface has to say so.
 */
export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareId: uuid("share_id")
      .notNull()
      .references(() => shares.id, { onDelete: "cascade" }),
    recipientLabel: text("recipient_label").notNull(),
    /** sha256 of the token, as sessions and invites already are. The plaintext exists only in the link. */
    tokenHash: text("token_hash").notNull(),
    /**
     * scrypt, `doorman` delivery only — not argon2id like an account password, because the
     * verifier is the doorman and the doorman carries no native dependencies (see
     * `@harbor/bundle/password`). On `bucket` there is no server to ask, so the password instead
     * *wraps the key* in the fragment and never reaches the database (§10.10).
     */
    passwordHash: text("password_hash"),
    /** NULL = unlimited. `doorman` only: counting downloads needs a stateful server. */
    maxDownloads: integer("max_downloads"),
    /** Completed downloads, not requests — a resumed transfer is not four downloads (§10.7). */
    downloadCount: integer("download_count").notNull().default(0),
    /** Narrows the share's expiry, never widens it. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
    lastDownloadedAt: timestamp("last_downloaded_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("share_links_token_idx").on(t.tokenHash), index("share_links_share_idx").on(t.shareId)],
);

/**
 * What strangers did. Distinct from `audit_log`, which records what *owners* did — creating a
 * share and revoking one are privileged actions and belong there.
 *
 * This table is a GDPR asset rather than a nicety (§10.7): handing third parties documents about
 * identifiable people is exactly the case where "what left, to whom, and when" is the record you
 * want to have. Rows arrive from the doorman's append-only events.jsonl, ingested by a worker —
 * the doorman has no database connection and no way to call the API.
 */
export const shareAccessLog = pgTable(
  "share_access_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareLinkId: uuid("share_link_id")
      .notNull()
      .references(() => shareLinks.id, { onDelete: "cascade" }),
    event: text("event", {
      enum: ["viewed", "password_failed", "download_started", "download_completed", "denied"],
    }).notNull(),
    /**
     * Why a request was denied — expired, revoked, limit reached, unknown token. The fetcher is
     * told none of this and cannot tell those apart; the owner reads it here (§10.6).
     */
    reason: text("reason"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    bytesSent: bigint("bytes_sent", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("share_access_link_idx").on(t.shareLinkId, t.createdAt)],
);
