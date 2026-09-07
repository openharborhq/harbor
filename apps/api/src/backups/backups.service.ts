import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createDecipheriv, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, desc, eq, sql } from "drizzle-orm";
import { backupRuns, documentFiles, documents, type Db } from "@harbor/db";
import { redactRepository, type BackupRun, type BackupStatus } from "@harbor/shared";
import type { Env } from "../config/env";
import { CryptoService } from "../crypto/crypto.service";
import { InjectDb } from "../db/db.module";
import type { LastRuns } from "./schedule";
import { CommandError, lastLines, parseBackupSummary, parseLatestSnapshot, run, type CommandResult } from "./restic";

const SAMPLE_BLOBS = 20;
const SCRATCH_DB = "harbor_restore_test";
const DUMP_NAME = "harbor.dump";

type Trigger = "scheduled" | "manual";
type RunRow = typeof backupRuns.$inferSelect;

/**
 * Spec §3.4, both halves. `runBackup` and `runRestoreTest` shell out to pg_dump/pg_restore and
 * restic and therefore only work inside the `backup` container; `status` and `list` are what the
 * API serves to Settings. Every outcome, including "nothing is configured", lands in
 * `backup_runs` — the table is the evidence the owner looks at, so it must never be quietly empty.
 */
@Injectable()
export class BackupsService {
  private readonly log = new Logger(BackupsService.name);
  private readonly env: Env;
  private readonly dataDir: string;

  constructor(
    @InjectDb() private readonly db: Db,
    config: ConfigService<Env, true>,
    private readonly crypto: CryptoService,
  ) {
    this.env = {
      DATABASE_URL: config.get("DATABASE_URL", { infer: true }),
      HARBOR_DATA_DIR: config.get("HARBOR_DATA_DIR", { infer: true }),
      RESTIC_REPOSITORY: config.get("RESTIC_REPOSITORY", { infer: true }),
      RESTIC_PASSWORD_FILE: config.get("RESTIC_PASSWORD_FILE", { infer: true }),
      BACKUP_HOUR: config.get("BACKUP_HOUR", { infer: true }),
      BACKUP_RESTORE_TEST_DAY: config.get("BACKUP_RESTORE_TEST_DAY", { infer: true }),
      BACKUP_KEEP_DAILY: config.get("BACKUP_KEEP_DAILY", { infer: true }),
      BACKUP_KEEP_MONTHLY: config.get("BACKUP_KEEP_MONTHLY", { infer: true }),
      BACKUP_PRUNE: config.get("BACKUP_PRUNE", { infer: true }),
    } as Env;
    this.dataDir = this.env.HARBOR_DATA_DIR;
  }

  get configured(): boolean {
    return Boolean(this.env.RESTIC_REPOSITORY && this.env.RESTIC_PASSWORD_FILE);
  }
  private get dumpsDir() {
    return path.join(this.dataDir, "dumps");
  }
  private get blobsDir() {
    return path.join(this.dataDir, "blobs");
  }
  private get tmpDir() {
    return path.join(this.dataDir, "tmp");
  }
  private blobPath(storageKey: string) {
    return path.join(this.blobsDir, storageKey.slice(0, 2), storageKey);
  }

  // ---- what Settings reads -------------------------------------------------------------------

  async status(): Promise<BackupStatus> {
    const [lastBackup, lastRestoreTest, running] = await Promise.all([this.latest("backup"), this.latest("restore_test"), this.running()]);
    return {
      configured: this.configured,
      repository: this.env.RESTIC_REPOSITORY ? redactRepository(this.env.RESTIC_REPOSITORY) : null,
      backupHour: this.env.BACKUP_HOUR,
      restoreTestDay: this.env.BACKUP_RESTORE_TEST_DAY,
      lastBackup,
      lastRestoreTest,
      running,
    };
  }

  async list(limit = 20): Promise<BackupRun[]> {
    const rows = await this.db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(limit);
    return rows.map(toView);
  }

  /** What the scheduler keys on (see schedule.ts). */
  async lastStarted(): Promise<LastRuns> {
    const startOf = async (kind: RunRow["kind"], status?: RunRow["status"]) => {
      const [row] = await this.db
        .select({ startedAt: backupRuns.startedAt })
        .from(backupRuns)
        .where(status ? and(eq(backupRuns.kind, kind), eq(backupRuns.status, status)) : eq(backupRuns.kind, kind))
        .orderBy(desc(backupRuns.startedAt))
        .limit(1);
      return row?.startedAt ?? null;
    };
    return { backup: await startOf("backup"), okBackup: await startOf("backup", "ok"), restoreTest: await startOf("restore_test") };
  }

  /** A row still `running` when the process starts belongs to a run the last process never finished. */
  async failStaleRuns(): Promise<number> {
    const rows = await this.db
      .update(backupRuns)
      .set({ status: "failed", finishedAt: new Date(), detail: { summary: "The backup process restarted before this run finished." } })
      .where(eq(backupRuns.status, "running"))
      .returning({ id: backupRuns.id });
    return rows.length;
  }

  // ---- the nightly backup --------------------------------------------------------------------

  async runBackup(trigger: Trigger): Promise<BackupRun> {
    const id = await this.begin("backup", trigger);
    const t0 = Date.now();
    try {
      this.requireConfigured();
      await mkdir(this.dumpsDir, { recursive: true, mode: 0o700 });
      const dump = path.join(this.dumpsDir, DUMP_NAME);
      // The server's own format: pg_restore can load it selectively and it is compressed.
      await this.exec("pg_dump", ["--format=custom", "--no-owner", `--file=${dump}.partial`, this.env.DATABASE_URL]);
      await rename(`${dump}.partial`, dump);
      const documentCount = await this.count(documents);

      await this.ensureRepository();
      const backup = await this.restic(["backup", "--json", "--exclude-caches", "--exclude=*.partial", this.dumpsDir, this.blobsDir]);
      const summary = parseBackupSummary(backup.stdout);

      let retention: string;
      if (this.env.BACKUP_PRUNE) {
        const keep = ["--keep-daily", String(this.env.BACKUP_KEEP_DAILY)];
        if (this.env.BACKUP_KEEP_MONTHLY > 0) keep.push("--keep-monthly", String(this.env.BACKUP_KEEP_MONTHLY));
        await this.restic(["forget", ...keep, "--prune"]);
        retention = `keeping ${this.env.BACKUP_KEEP_DAILY} daily / ${this.env.BACKUP_KEEP_MONTHLY} monthly`;
      } else {
        retention = "no pruning from this box (BACKUP_PRUNE=false)";
      }
      const seconds = Math.round((Date.now() - t0) / 1000);
      return this.finish(id, {
        status: "ok",
        snapshotId: summary.snapshotId,
        bytes: summary.bytes,
        documentCount,
        detail: {
          summary: `Snapshot ${summary.snapshotId.slice(0, 8)}: ${documentCount} documents, ${summary.filesNew} new and ${summary.filesChanged} changed files, ${seconds}s · ${retention}`,
          filesNew: summary.filesNew,
          filesChanged: summary.filesChanged,
          seconds,
          retention,
        },
      });
    } catch (err) {
      return this.finish(id, { status: "failed", detail: { summary: this.describe(err) } });
    }
  }

  // ---- the monthly restore test --------------------------------------------------------------

  /**
   * Restore the latest snapshot to scratch, load the dump into a scratch database on the same
   * server, decrypt a random sample of blobs with the KEK and compare their sha256 with what
   * `document_files` says they were on upload. Passing means the backup can be read back — the
   * only definition of "backed up" that counts.
   */
  async runRestoreTest(trigger: Trigger): Promise<BackupRun> {
    const id = await this.begin("restore_test", trigger);
    const scratch = path.join(this.tmpDir, `restore-test-${id}`);
    try {
      this.requireConfigured();
      const latest = parseLatestSnapshot((await this.restic(["snapshots", "--json", "--latest", "1"])).stdout);
      if (!latest) throw new Error("The repository has no snapshots yet — run a backup first.");

      const sample = await this.db
        .select({ storageKey: documentFiles.storageKey, sha256: documentFiles.sha256, dekWrapped: documentFiles.dekWrapped, iv: documentFiles.iv, authTag: documentFiles.authTag })
        .from(documentFiles)
        .orderBy(sql`random()`)
        .limit(SAMPLE_BLOBS);

      const dumpPath = path.join(this.dumpsDir, DUMP_NAME);
      const includes = [dumpPath, ...sample.map((f) => this.blobPath(f.storageKey))].flatMap((p) => ["--include", p]);
      await mkdir(scratch, { recursive: true, mode: 0o700 });
      // restic keeps absolute paths, so /data/blobs/ab/… lands at <scratch>/data/blobs/ab/….
      await this.restic(["restore", latest.id, "--target", scratch, ...includes]);

      const restoredDump = path.join(scratch, dumpPath);
      let bytes = (await stat(restoredDump)).size;
      const counts = await this.loadIntoScratchDb(restoredDump);

      let verified = 0;
      const problems: string[] = [];
      for (const f of sample) {
        const p = path.join(scratch, this.blobPath(f.storageKey));
        try {
          bytes += (await stat(p)).size;
          const digest = await this.decryptedSha256(p, f);
          if (digest === f.sha256) verified++;
          else problems.push(`${f.storageKey.slice(0, 8)}: content differs from upload`);
        } catch (err) {
          problems.push(`${f.storageKey.slice(0, 8)}: ${this.describe(err)}`);
        }
      }
      const ok = problems.length === 0;
      const when = latest.time ? new Date(latest.time).toISOString().slice(0, 16).replace("T", " ") : "?";
      return this.finish(id, {
        status: ok ? "ok" : "failed",
        snapshotId: latest.id,
        bytes,
        documentCount: counts.documents,
        detail: {
          summary: ok
            ? `Snapshot ${latest.id.slice(0, 8)} (${when}): dump loads with ${counts.documents} documents and ${counts.files} files; ${verified} of ${sample.length} sampled blobs decrypt to the bytes that were uploaded`
            : `${problems.length} of ${sample.length} sampled blobs failed: ${problems.slice(0, 3).join("; ")}`,
          sampled: sample.length,
          verified,
          problems,
          dumpDocuments: counts.documents,
          dumpFiles: counts.files,
        },
      });
    } catch (err) {
      return this.finish(id, { status: "failed", detail: { summary: this.describe(err) } });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  /** A scratch database on the live server: the same thing a real restore does, minus the rename. */
  private async loadIntoScratchDb(dump: string): Promise<{ documents: number; files: number }> {
    const admin = this.env.DATABASE_URL;
    const scratchUrl = new URL(admin);
    scratchUrl.pathname = `/${SCRATCH_DB}`;
    await this.exec("psql", [admin, "-v", "ON_ERROR_STOP=1", "-qc", `DROP DATABASE IF EXISTS ${SCRATCH_DB}`]);
    await this.exec("psql", [admin, "-v", "ON_ERROR_STOP=1", "-qc", `CREATE DATABASE ${SCRATCH_DB} TEMPLATE template0`]);
    try {
      await this.exec("pg_restore", ["--no-owner", "--exit-on-error", `--dbname=${scratchUrl}`, dump]);
      const out = await this.exec("psql", [scratchUrl.toString(), "-tAc", "select (select count(*) from documents) || ' ' || (select count(*) from document_files)"]);
      const [d, f] = out.stdout.trim().split(" ").map(Number);
      if (!Number.isFinite(d) || !Number.isFinite(f)) throw new Error(`could not count rows in the restored database: ${lastLines(out.stdout)}`);
      return { documents: d, files: f };
    } finally {
      await this.exec("psql", [admin, "-qc", `DROP DATABASE IF EXISTS ${SCRATCH_DB}`]).catch((err) => this.log.warn(`scratch database not dropped: ${this.describe(err)}`));
    }
  }

  /** Unwrap the DEK under the KEK (bound to the storage key, as BlobStore does) and hash the plaintext. */
  private async decryptedSha256(file: string, f: { storageKey: string; dekWrapped: Buffer; iv: Buffer; authTag: Buffer }): Promise<string> {
    const dek = this.crypto.open(f.dekWrapped, Buffer.from(f.storageKey));
    const decipher = createDecipheriv("aes-256-gcm", dek, f.iv);
    decipher.setAuthTag(f.authTag);
    const hash = createHash("sha256");
    await pipeline(
      createReadStream(file),
      decipher,
      new Writable({
        write(chunk: Buffer, _enc, cb) {
          hash.update(chunk);
          cb();
        },
      }),
    );
    return hash.digest("hex");
  }

  // ---- plumbing ------------------------------------------------------------------------------

  private requireConfigured(): void {
    if (!this.configured) throw new Error("No backup repository is configured: set RESTIC_REPOSITORY (and the restic password secret) on the appliance.");
  }

  /** First run against an empty location: initialise the repository rather than fail. */
  private async ensureRepository(): Promise<void> {
    const probe = await run("restic", ["cat", "config"], this.resticEnv());
    if (probe.code === 0) return;
    const init = await run("restic", ["init"], this.resticEnv());
    if (init.code !== 0) throw new CommandError("restic init", init);
  }

  private resticEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      RESTIC_REPOSITORY: this.env.RESTIC_REPOSITORY,
      RESTIC_PASSWORD_FILE: this.env.RESTIC_PASSWORD_FILE,
      // The container's filesystem is read-only; the data volume's tmp is where restic may write.
      RESTIC_CACHE_DIR: path.join(this.tmpDir, "restic-cache"),
      RESTIC_PROGRESS_FPS: "0.1",
    };
  }

  private async restic(args: string[]): Promise<CommandResult> {
    const result = await run("restic", args, this.resticEnv());
    if (result.code !== 0) throw new CommandError(`restic ${args[0]}`, result);
    return result;
  }

  private async exec(cmd: string, args: string[]): Promise<CommandResult> {
    const result = await run(cmd, args, process.env);
    if (result.code !== 0) throw new CommandError(cmd, result);
    return result;
  }

  private async count(table: typeof documents): Promise<number> {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(table);
    return row?.n ?? 0;
  }

  private async begin(kind: RunRow["kind"], trigger: Trigger): Promise<string> {
    const [row] = await this.db.insert(backupRuns).values({ kind, trigger, status: "running" }).returning({ id: backupRuns.id });
    this.log.log(`${kind} started (${trigger})`);
    return row!.id;
  }

  private async finish(id: string, patch: Partial<Pick<RunRow, "status" | "snapshotId" | "bytes" | "documentCount" | "detail">>): Promise<BackupRun> {
    const [row] = await this.db
      .update(backupRuns)
      .set({ ...patch, finishedAt: new Date() })
      .where(eq(backupRuns.id, id))
      .returning();
    const view = toView(row!);
    (view.status === "ok" ? this.log.log : this.log.warn).call(this.log, `${view.kind} ${view.status}: ${view.summary}`);
    return view;
  }

  private async latest(kind: RunRow["kind"]): Promise<BackupRun | null> {
    const [row] = await this.db.select().from(backupRuns).where(eq(backupRuns.kind, kind)).orderBy(desc(backupRuns.startedAt)).limit(1);
    return row ? toView(row) : null;
  }

  private async running(): Promise<BackupRun | null> {
    const [row] = await this.db.select().from(backupRuns).where(eq(backupRuns.status, "running")).orderBy(desc(backupRuns.startedAt)).limit(1);
    return row ? toView(row) : null;
  }

  /** Errors are shown on a settings page; strip anything that could carry a credential. */
  private describe(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    return this.env.RESTIC_REPOSITORY ? msg.replaceAll(this.env.RESTIC_REPOSITORY, redactRepository(this.env.RESTIC_REPOSITORY)) : msg;
  }
}

export function toView(row: RunRow): BackupRun {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    snapshotId: row.snapshotId,
    bytes: row.bytes,
    documentCount: row.documentCount,
    summary: typeof row.detail?.summary === "string" ? row.detail.summary : null,
  };
}
