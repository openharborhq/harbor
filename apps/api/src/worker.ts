import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Worker, type Job } from "bullmq";
import type IORedis from "ioredis";
import { closeDb, createDb, runMigrations } from "@harbor/db";
import { loadEnv } from "./config/env";
import { FileProcessor, JOB_TIMEOUT_MS } from "./processing/file-processor.service";
import { PROCESS_FILE_QUEUE, REDIS, type ProcessFileJob } from "./queue/queue.module";
import { WorkerModule } from "./worker.module";

/**
 * Second entrypoint for the same codebase (spec §3.7). Runs BullMQ processors only; no HTTP.
 * Ships in the container that carries the OCR toolchain and has no internet egress (spec §3.6).
 */
async function bootstrap() {
  const env = loadEnv();
  const log = new Logger("worker");
  {
    // createApplicationContext() runs onModuleInit hooks immediately; migrate with a throwaway connection first.
    const db = createDb(env.DATABASE_URL);
    try {
      await runMigrations(db);
    } finally {
      await closeDb(db);
    }
  }
  const app = await NestFactory.createApplicationContext(WorkerModule);

  const processor = app.get(FileProcessor);
  const worker = new Worker<ProcessFileJob>(
    PROCESS_FILE_QUEUE,
    async (job: Job<ProcessFileJob>) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), JOB_TIMEOUT_MS);
      try {
        return await processor.process(job.data.documentFileId, {
          signal: ac.signal,
          progress: (fraction) => job.updateProgress(Math.round(fraction * 100)),
        });
      } finally {
        clearTimeout(timer);
      }
    },
    {
      connection: app.get<IORedis>(REDIS),
      concurrency: env.OCR_CONCURRENCY,
      lockDuration: 60_000,
      stalledInterval: 30_000,
    },
  );

  worker.on("completed", (job, result) => log.log(`job ${job.id} done: ${JSON.stringify(result)}`));
  worker.on("failed", (job, err) => log.warn(`job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`));
  worker.on("error", (err) => log.error(`worker error: ${err.message}`));
  log.log(`worker ready · queue ${PROCESS_FILE_QUEUE} · concurrency ${env.OCR_CONCURRENCY} · languages ${env.OCR_LANGUAGES}`);

  const shutdown = async (signal: string) => {
    log.log(`${signal}: draining (in-flight jobs finish, no new ones)`);
    await worker.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
void bootstrap();
