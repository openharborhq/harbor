import { z } from "zod/v4";

export const BackupRunKind = z.enum(["backup", "restore_test"]);
export type BackupRunKind = z.infer<typeof BackupRunKind>;

export const BackupRun = z.object({
  id: z.string().uuid(),
  kind: BackupRunKind,
  status: z.enum(["running", "ok", "failed"]),
  trigger: z.enum(["scheduled", "manual"]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  snapshotId: z.string().nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  documentCount: z.number().int().nonnegative().nullable(),
  /** The error, or a one-line account of what was verified. */
  summary: z.string().nullable(),
});
export type BackupRun = z.infer<typeof BackupRun>;

/**
 * What Settings shows above the run list (spec §3.4, §4). `configured` is false until the
 * operator has set a restic repository — the state a fresh install is in, and the one that must
 * read as "you have no backups", not as an empty list.
 */
export const BackupStatus = z.object({
  configured: z.boolean(),
  /** The repository with any credentials stripped, e.g. `b2:harbor-backups:/` or `/backup`. */
  repository: z.string().nullable(),
  /** Local hour (0–23) the nightly backup starts, and day of month of the restore test. */
  backupHour: z.number().int().min(0).max(23),
  restoreTestDay: z.number().int().min(1).max(28),
  lastBackup: BackupRun.nullable(),
  lastRestoreTest: BackupRun.nullable(),
  /** A run in flight right now, so the buttons can say so instead of queueing a second one. */
  running: BackupRun.nullable(),
});
export type BackupStatus = z.infer<typeof BackupStatus>;

export const RunBackup = z.object({ kind: BackupRunKind });
export type RunBackup = z.infer<typeof RunBackup>;

/** Only the scheme and the bucket/path of a restic repository, never a key embedded in it. */
export function redactRepository(repo: string): string {
  return repo.replace(/\/\/[^@/]+@/, "//");
}
