export interface ScheduleConfig {
  /** Local hour (0–23) the nightly backup starts. */
  backupHour: number;
  /** Day of month (1–28) of the automated restore test. */
  restoreTestDay: number;
}

export interface LastRuns {
  /** Start of the latest backup, whatever its outcome — it sets the once-a-day gap. */
  backup: Date | null;
  /** Start of the latest backup that succeeded — a restore test only means something after one. */
  okBackup: Date | null;
  restoreTest: Date | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Decides what the once-a-minute tick should start, if anything (spec §3.4). Everything is keyed
 * on what `backup_runs` already holds, so a restart never doubles a night's backup and a process
 * that was down at 03:00 does not run twelve catch-up backups at noon.
 *
 * The restore test follows a successful backup on its day of the month, whichever hour that
 * backup finished at — a first snapshot of a large vault can take longer than an hour, and the
 * test must not miss its month because of it.
 */
export function due(now: Date, last: LastRuns, cfg: ScheduleConfig): "backup" | "restore_test" | null {
  const since = (d: Date | null) => (d ? now.getTime() - d.getTime() : Infinity);
  if (now.getHours() === cfg.backupHour && since(last.backup) > 20 * HOUR) return "backup";
  if (now.getDate() === cfg.restoreTestDay && since(last.okBackup) <= 20 * HOUR && since(last.restoreTest) > 20 * DAY) return "restore_test";
  return null;
}
