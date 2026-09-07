import "reflect-metadata";
import { Logger, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { Worker, type Job } from "bullmq";
import type IORedis from "ioredis";
import { closeDb, createDb, runMigrations } from "@harbor/db";
import { BackupsModule } from "./backups/backups.module";
import { BackupsService } from "./backups/backups.service";
import { due } from "./backups/schedule";
import { loadEnv } from "./config/env";
import { CryptoModule } from "./crypto/crypto.module";
import { DbModule } from "./db/db.module";
import { BACKUP_OPS_QUEUE, REDIS, QueueModule, type BackupOpsJob } from "./queue/queue.module";

/**
 * Fifth entrypoint (spec §3.4): the only process with restic, the Postgres client tools and a
 * route to the backup repository. It runs the nightly backup and the monthly restore test on a
 * clock, and the same two things on demand from Settings.
 *
 *   node dist/backup.js                    the daemon
 *   node dist/backup.js run backup         one backup now, exit 0 if it succeeded
 *   node dist/backup.js run restore_test   one restore test now, exit 0 if it passed
 *
 * The one-shot form is what `scripts/stack-test.sh` and the update procedure use.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (config) => loadEnv(config as NodeJS.ProcessEnv) }),
    DbModule,
    CryptoModule,
    QueueModule,
    BackupsModule,
  ],
})
class BackupModule {}

async function bootstrap() {
  const env = loadEnv();
  const log = new Logger("backup");
  await migrateFirst(env.DATABASE_URL);
  const app = await NestFactory.createApplicationContext(BackupModule, { logger: ["error", "warn", "log"] });
  const backups = app.get(BackupsService);
  const cfg = { backupHour: env.BACKUP_HOUR, restoreTestDay: env.BACKUP_RESTORE_TEST_DAY };

  const [mode, kind] = process.argv.slice(2);
  if (mode === "run") {
    if (kind !== "backup" && kind !== "restore_test") {
      console.error("usage: node dist/backup.js run backup|restore_test");
      process.exit(2);
    }
    const result = kind === "backup" ? await backups.runBackup("manual") : await backups.runRestoreTest("manual");
    console.log(`${result.kind} ${result.status}: ${result.summary}`);
    await app.close();
    process.exit(result.status === "ok" ? 0 : 1);
  }

  const stale = await backups.failStaleRuns();
  if (stale) log.warn(`${stale} run(s) left running by a previous process marked failed`);

  // One thing at a time: a manual "back up now" waits for a scheduled run in flight, and vice versa.
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  const start = (k: BackupOpsJob["kind"], trigger: "scheduled" | "manual") =>
    exclusive(() => (k === "backup" ? backups.runBackup(trigger) : backups.runRestoreTest(trigger)));

  let stopping = false;
  const tick = async () => {
    if (stopping) return;
    try {
      const k = due(new Date(), await backups.lastStarted(), cfg);
      if (k) await start(k, "scheduled");
    } catch (err) {
      log.error(`tick failed: ${(err as Error).message}`);
    }
  };

  const worker = new Worker<BackupOpsJob>(BACKUP_OPS_QUEUE, (job: Job<BackupOpsJob>) => start(job.data.kind, "manual"), {
    connection: app.get<IORedis>(REDIS),
    concurrency: 1,
  });
  worker.on("failed", (job, err) => log.warn(`${job?.data?.kind} failed: ${err.message}`));

  const timer = setInterval(() => void tick(), 60_000);
  void tick();
  log.log(
    backups.configured
      ? `backup ready · nightly at ${String(env.BACKUP_HOUR).padStart(2, "0")}:00 · restore test on day ${env.BACKUP_RESTORE_TEST_DAY}`
      : "backup ready · NOT CONFIGURED: set RESTIC_REPOSITORY and the restic password secret (docs/deploy.md §5)",
  );

  const shutdown = async (signal: string) => {
    log.log(`${signal}: stopping`);
    stopping = true;
    clearInterval(timer);
    await worker.close();
    await chain;
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

async function migrateFirst(url: string) {
  const db = createDb(url);
  try {
    await runMigrations(db);
  } finally {
    await closeDb(db);
  }
}
void bootstrap();
