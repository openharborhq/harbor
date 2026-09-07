import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { closeDb, createDb, type Db } from "@harbor/db";
import type { Env } from "../config/env";

export const DB = Symbol("DB");
export const InjectDb = () => Inject(DB);

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createDb(config.get("DATABASE_URL", { infer: true })),
    },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@InjectDb() private readonly db: Db) {}
  async onApplicationShutdown() {
    await closeDb(this.db);
  }
}
