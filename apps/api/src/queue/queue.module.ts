import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Env } from "../config/env";

export const PROCESS_FILE_QUEUE = "process-file";
export const SUGGEST_QUEUE = "suggest";
export const MAIL_OPS_QUEUE = "mail-ops";
export const BACKUP_OPS_QUEUE = "backup-ops";
export const REDIS = Symbol("REDIS");
export const PROCESS_FILE = Symbol("PROCESS_FILE");
export const SUGGEST = Symbol("SUGGEST");
export const MAIL_OPS = Symbol("MAIL_OPS");
export const BACKUP_OPS = Symbol("BACKUP_OPS");
export const InjectProcessFileQueue = () => Inject(PROCESS_FILE);
export const InjectSuggestQueue = () => Inject(SUGGEST);
export const InjectMailOpsQueue = () => Inject(MAIL_OPS);
export const InjectBackupOpsQueue = () => Inject(BACKUP_OPS);

export interface ProcessFileJob {
  documentFileId: string;
}
export interface SuggestJob {
  documentFileId: string;
}

/**
 * Work that has to happen inside `mailfetch`, because it is the only process with a route to an
 * IMAP host — and, more to the point, the only one that should ever unseal a mail password
 * (spec §3.6, §7.10). The API enqueues these and never opens a mailbox itself.
 *
 * Only a connection id travels over Redis. A password never does: a connection is created sealed
 * first and tested afterwards, so plaintext credentials are never written to a queue.
 */
export interface MailOpsJob {
  kind: "test" | "sync" | "backfill" | "apply-rules";
  connectionId: string;
  /** `backfill` only: how many months back to read. Absent means the default window. */
  months?: number;
}

/**
 * "Back up now" and "test a restore now" from Settings (spec §3.4). Only the `backup` container
 * has restic and a route to the repository, so the API enqueues and never runs one itself.
 */
export interface BackupOpsJob {
  kind: "backup" | "restore_test";
}

export function createRedis(url: string): IORedis {
  // BullMQ requires maxRetriesPerRequest: null so blocking commands are not cut short.
  return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createRedis(config.get("REDIS_URL", { infer: true })),
    },
    {
      provide: PROCESS_FILE,
      inject: [REDIS],
      useFactory: (redis: IORedis) =>
        new Queue<ProcessFileJob>(PROCESS_FILE_QUEUE, {
          connection: redis,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: "exponential", delay: 30_000 },
            removeOnComplete: { count: 1000 },
            removeOnFail: { count: 5000 },
          },
        }),
    },
    {
      provide: MAIL_OPS,
      inject: [REDIS],
      useFactory: (redis: IORedis) =>
        new Queue<MailOpsJob>(MAIL_OPS_QUEUE, {
          connection: redis,
          defaultJobOptions: {
            // A mailbox that is down stays down for a while; retry slowly and give up visibly.
            attempts: 3,
            backoff: { type: "exponential", delay: 60_000 },
            removeOnComplete: { count: 200 },
            removeOnFail: { count: 500 },
          },
        }),
    },
    {
      provide: BACKUP_OPS,
      inject: [REDIS],
      useFactory: (redis: IORedis) =>
        new Queue<BackupOpsJob>(BACKUP_OPS_QUEUE, {
          connection: redis,
          // A backup that failed is a fact to show, not something to retry behind the owner's back.
          defaultJobOptions: { attempts: 1, removeOnComplete: { count: 50 }, removeOnFail: { count: 100 } },
        }),
    },
    {
      provide: SUGGEST,
      inject: [REDIS],
      useFactory: (redis: IORedis) =>
        new Queue<SuggestJob>(SUGGEST_QUEUE, {
          connection: redis,
          defaultJobOptions: {
            attempts: 4,
            backoff: { type: "exponential", delay: 20_000 },
            removeOnComplete: { count: 1000 },
            removeOnFail: { count: 5000 },
          },
        }),
    },
  ],
  exports: [REDIS, PROCESS_FILE, SUGGEST, MAIL_OPS, BACKUP_OPS],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(PROCESS_FILE) private readonly queue: Queue,
    @Inject(SUGGEST) private readonly suggestQueue: Queue,
    @Inject(MAIL_OPS) private readonly mailOpsQueue: Queue,
    @Inject(BACKUP_OPS) private readonly backupOpsQueue: Queue,
    @Inject(REDIS) private readonly redis: IORedis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.suggestQueue.close();
    await this.mailOpsQueue.close();
    await this.backupOpsQueue.close();
    await this.redis.quit();
  }
}
