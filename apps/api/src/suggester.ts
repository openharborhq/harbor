import "reflect-metadata";
import { Logger, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import type IORedis from "ioredis";
import { closeDb, createDb, runMigrations, type Db } from "@harbor/db";
import { AuditModule } from "./audit/audit.module";
import { loadEnv } from "./config/env";
import { CryptoModule } from "./crypto/crypto.module";
import { DbModule } from "./db/db.module";
import { REDIS, QueueModule, SUGGEST_QUEUE, type SuggestJob } from "./queue/queue.module";
import { SuggestModule } from "./suggest/suggest.module";
import { SuggestService } from "./suggest/suggest.service";
import { VocabularyModule } from "./vocabulary/vocabulary.module";

/**
 * Third entrypoint (spec §3.6): the only processing container with a route to the internet,
 * allow-listed to the LLM provider. It reads document_text only — never blobs, never OCR tools.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (config) => loadEnv(config as NodeJS.ProcessEnv) }),
    DbModule,
    CryptoModule,
    AuditModule,
    QueueModule,
    VocabularyModule,
    SuggestModule.register({ withProvider: true }),
  ],
})
class SuggesterModule {}

async function bootstrap() {
  const env = loadEnv();
  const log = new Logger("suggester");
  await migrateFirst(env.DATABASE_URL);
  const app = await NestFactory.createApplicationContext(SuggesterModule);
  const suggest = app.get(SuggestService);

  const worker = new Worker<SuggestJob>(
    SUGGEST_QUEUE,
    async (job: Job<SuggestJob>) => {
      const { documentFileId } = job.data;
      try {
        // suggestForFile leaves "suggesting" in the same transaction that stores the suggestion.
        return { suggestionId: await suggest.suggestForFile(documentFileId) };
      } catch (err) {
        const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        if (lastAttempt || err instanceof UnrecoverableError) {
          // Suggestions are best-effort: the document is still complete without one.
          await suggest.markReady(documentFileId);
          log.warn(`${documentFileId}: giving up on suggestion: ${(err as Error).message}`);
          return { suggestionId: null };
        }
        throw err;
      }
    },
    { connection: app.get<IORedis>(REDIS), concurrency: 2 },
  );
  worker.on("failed", (job, err) => log.warn(`job ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`));
  log.log(`suggester ready · provider ${env.SUGGEST_PROVIDER} · model ${env.SUGGEST_MODEL} · people ${env.SUGGEST_SEND_PEOPLE ? "sent" : "withheld"}`);

  const shutdown = async (signal: string) => {
    log.log(`${signal}: draining`);
    await worker.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
/** createApplicationContext() runs onModuleInit hooks (e.g. category seeding) at once, so migrate with a throwaway connection first. */
async function migrateFirst(url: string) {
  const db = createDb(url);
  try {
    await runMigrations(db);
  } finally {
    await closeDb(db);
  }
}
void bootstrap();
