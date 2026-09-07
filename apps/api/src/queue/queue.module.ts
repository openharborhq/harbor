import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Env } from "../config/env";

export const PROCESS_FILE_QUEUE = "process-file";
export const SUGGEST_QUEUE = "suggest";
export const REDIS = Symbol("REDIS");
export const PROCESS_FILE = Symbol("PROCESS_FILE");
export const SUGGEST = Symbol("SUGGEST");
export const InjectProcessFileQueue = () => Inject(PROCESS_FILE);
export const InjectSuggestQueue = () => Inject(SUGGEST);

export interface ProcessFileJob {
  documentFileId: string;
}
export interface SuggestJob {
  documentFileId: string;
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
  exports: [REDIS, PROCESS_FILE, SUGGEST],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(PROCESS_FILE) private readonly queue: Queue,
    @Inject(SUGGEST) private readonly suggestQueue: Queue,
    @Inject(REDIS) private readonly redis: IORedis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.suggestQueue.close();
    await this.redis.quit();
  }
}
