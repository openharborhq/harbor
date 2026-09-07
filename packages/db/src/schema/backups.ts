import { pgTable, uuid, text, jsonb, bigint, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * One row per backup or restore test (spec §3.4). The `backup` container writes them; Settings
 * reads them. A restore test that was never run, or failed, is a fact the owner must be able to
 * see — "the backups are fine" is a claim this table either backs or does not.
 */
export const backupRuns = pgTable(
  "backup_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["backup", "restore_test"] }).notNull(),
    status: text("status", { enum: ["running", "ok", "failed"] }).notNull().default("running"),
    /** `scheduled` from the nightly clock, `manual` from the Settings button. */
    trigger: text("trigger", { enum: ["scheduled", "manual"] }).notNull().default("scheduled"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** The restic snapshot this run wrote (backup) or read (restore test). */
    snapshotId: text("snapshot_id"),
    /** backup: bytes restic processed. restore_test: bytes restored to scratch. */
    bytes: bigint("bytes", { mode: "number" }),
    /** backup: documents in the dump. restore_test: documents counted in the restored database. */
    documentCount: integer("document_count"),
    /** Human-readable outcome — the error, or what was verified. Never a secret. */
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [index("backup_runs_started_idx").on(t.startedAt)],
);
