import "reflect-metadata";
import { Logger, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { Queue, UnrecoverableError, Worker, type Job } from "bullmq";
import type IORedis from "ioredis";
import { closeDb, createDb, runMigrations, type Db } from "@harbor/db";
import { AuditModule } from "./audit/audit.module";
import { loadEnv } from "./config/env";
import { CryptoModule } from "./crypto/crypto.module";
import { DbModule } from "./db/db.module";
import { REDIS, SUGGEST, QueueModule, SUGGEST_QUEUE, type SuggestJob } from "./queue/queue.module";
import { SuggestModule } from "./suggest/suggest.module";
import { PROMPT_VERSION } from "./suggest/provider";
import { SuggestService } from "./suggest/suggest.service";
import { VocabularyModule } from "./vocabulary/vocabulary.module";

/**
 * Third entrypoint (spec §3.6): the only processing container with a route to the internet,
 * allow-listed to the LLM provider. It reads document_text only — never blobs, never OCR tools.
 *
 *   node dist/suggester.js                        the worker
 *   node dist/suggester.js rerun --dry-run        how many documents predate the current prompt
 *   node dist/suggester.js rerun --limit 50       re-read that many, newest first
 *
 * `rerun` exists because a prompt version bump changes what the model is asked, and every stored
 * answer is to the older question. It is never automatic: at a hosted provider this spends real
 * money per document, and that is the operator's call, not a side effect of deploying.
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

  if (process.argv[2] === "rerun") {
    const args = process.argv.slice(3);
    const dryRun = args.includes("--dry-run");
    const at = args.indexOf("--limit");
    const limit = at === -1 ? 500 : Number(args[at + 1]);
    if (!Number.isInteger(limit) || limit < 1) {
      console.error("usage: node dist/suggester.js rerun [--limit N] [--dry-run]");
      process.exit(2);
    }
    const stale = await suggest.staleFiles(limit);
    console.log(`${stale.length} document${stale.length === 1 ? "" : "s"} have no suggestion from the current prompt (version ${PROMPT_VERSION})`);
    if (dryRun || stale.length === 0) {
      if (!dryRun) console.log("nothing to do");
      await app.close();
      process.exit(0);
    }
    if (env.SUGGEST_PROVIDER === "none") console.log("provider is `none`: this re-reads them with the built-in heuristics and costs nothing");
    const queue = app.get<Queue<SuggestJob>>(SUGGEST);
    await queue.addBulk(stale.map((documentFileId) => ({ name: "suggest", data: { documentFileId } })));
    console.log(`queued ${stale.length}; the suggester works through them — watch its log, or run this again to see what is left`);
    await app.close();
    process.exit(0);
  }

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
  // Say it once at boot rather than acting on it: the operator decides whether to spend on a re-read.
  const stale = await suggest.staleFiles(1_000);
  if (stale.length) log.log(`${stale.length} document(s) have no suggestion from prompt version ${PROMPT_VERSION} — \`node dist/suggester.js rerun\` re-reads them`);

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
