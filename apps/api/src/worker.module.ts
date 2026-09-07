import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuditModule } from "./audit/audit.module";
import { loadEnv } from "./config/env";
import { CryptoModule } from "./crypto/crypto.module";
import { DbModule } from "./db/db.module";
import { ProcessingModule } from "./processing/processing.module";
import { QueueModule } from "./queue/queue.module";
import { StorageModule } from "./storage/storage.module";

/** The worker's dependency graph: no HTTP, no auth, no controllers. Same code, second entrypoint. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (config) => loadEnv(config as NodeJS.ProcessEnv) }),
    DbModule,
    CryptoModule,
    AuditModule,
    StorageModule,
    QueueModule,
    ProcessingModule,
  ],
})
export class WorkerModule {}
