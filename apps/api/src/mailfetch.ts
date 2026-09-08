import "reflect-metadata";
import { Logger, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { Worker, type Job } from "bullmq";
import type IORedis from "ioredis";
import { closeDb, createDb, runMigrations } from "@harbor/db";
import { AuditModule } from "./audit/audit.module";
import { loadEnv } from "./config/env";
import { CryptoModule } from "./crypto/crypto.module";
import { DbModule } from "./db/db.module";
import { DocumentsModule } from "./documents/documents.module";
import { MailConnectionsService } from "./mail/mail-connections.service";
import { MailFetcherService } from "./mail/mail-fetcher.service";
import { MailModule } from "./mail/mail.module";
import { SettingsModule } from "./settings/settings.module";
import { MAIL_OPS_QUEUE, REDIS, QueueModule, type MailOpsJob } from "./queue/queue.module";
import { StorageModule } from "./storage/storage.module";
import { SuggestModule } from "./suggest/suggest.module";
import { VocabularyModule } from "./vocabulary/vocabulary.module";

/**
 * Fourth entrypoint (spec §3.6, §7): the only process that opens a mailbox. Its egress allow-list
 * is the IMAP hosts of the configured connections and nothing else — it holds mail credentials,
 * so it gets no route anywhere they would be useful to anyone but it.
 *
 * It enqueues work for the OCR worker exactly as an upload does; it never runs OCR itself and
 * never touches a blob.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (config) => loadEnv(config as NodeJS.ProcessEnv) }),
    DbModule,
    CryptoModule,
    AuditModule,
    StorageModule,
    QueueModule,
    SettingsModule,
    VocabularyModule,
    SuggestModule.register({ withProvider: false }),
    DocumentsModule,
    MailModule,
  ],
})
class MailFetchModule {}

async function bootstrap() {
  const env = loadEnv();
  const log = new Logger("mailfetch");
  await migrateFirst(env.DATABASE_URL);
  const app = await NestFactory.createApplicationContext(MailFetchModule);
  const fetcher = app.get(MailFetcherService);

  let running = false;
  let stopping = false;

  /**
   * Passes never overlap. A slow mailbox delays the next pass rather than stacking a second
   * connection on top of it, which is how an app password gets rate-limited.
   */
  const pass = async () => {
    if (running || stopping) return;
    running = true;
    try {
      const summaries = await fetcher.syncAll();
      for (const s of summaries.filter((s) => s.scanned || s.problem)) {
        log.log(`${s.connectionId}: scanned ${s.scanned} · filed ${s.filed} · held ${s.held}${s.problem ? ` · ${s.problem}` : ""}`);
      }
    } catch (err) {
      // A pass that throws must not take the process with it; the next one starts clean.
      log.error(`sync pass failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };

  /**
   * On-demand work from the API: testing a connection, the explicit backfill, a sync now, and
   * filing the backlog a sender approval just unlocked. Concurrency 1 — one mailbox at a time is
   * plenty on this hardware, and it keeps a backfill from starving the ordinary sweep.
   */
  const connections = app.get(MailConnectionsService);
  const worker = new Worker<MailOpsJob>(
    MAIL_OPS_QUEUE,
    async (job: Job<MailOpsJob>) => {
      const { kind, connectionId, months } = job.data;
      switch (kind) {
        case "test":
          return { ok: (await connections.testConnection(connectionId)).ok };
        case "backfill":
          return fetcher.backfill(connectionId, undefined, months);
        case "apply-rules":
          return fetcher.applyRules(connectionId);
        case "sync":
          return fetcher.syncConnection(connectionId);
      }
    },
    { connection: app.get<IORedis>(REDIS), concurrency: 1 },
  );
  worker.on("failed", (job, err) => log.warn(`${job?.data?.kind} for ${job?.data?.connectionId} failed: ${err.message}`));

  const timer = setInterval(() => void pass(), env.MAIL_SYNC_INTERVAL_SECONDS * 1000);
  void pass();
  log.log(`mailfetch ready · sync every ${env.MAIL_SYNC_INTERVAL_SECONDS}s`);

  const shutdown = async (signal: string) => {
    log.log(`${signal}: stopping`);
    stopping = true;
    clearInterval(timer);
    await worker.close();
    // Let a pass in flight finish rather than dropping a half-filed message.
    while (running) await new Promise((r) => setTimeout(r, 100));
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

/** As in the other entrypoints: migrate on a throwaway connection before module init runs. */
async function migrateFirst(url: string) {
  const db = createDb(url);
  try {
    await runMigrations(db);
  } finally {
    await closeDb(db);
  }
}
void bootstrap();
