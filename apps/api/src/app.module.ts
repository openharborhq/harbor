import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { loadEnv } from "./config/env";
import { CryptoModule } from "./crypto/crypto.module";
import { DbModule } from "./db/db.module";
import { DocumentsModule } from "./documents/documents.module";
import { HealthController } from "./health/health.controller";
import { QueueModule } from "./queue/queue.module";
import { SearchModule } from "./search/search.module";
import { StorageModule } from "./storage/storage.module";
import { SuggestModule } from "./suggest/suggest.module";
import { VocabularyModule } from "./vocabulary/vocabulary.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Validate once; downstream services inject a typed Env instead of reading process.env.
      validate: (config) => loadEnv(config as NodeJS.ProcessEnv),
    }),
    DbModule,
    CryptoModule,
    AuditModule,
    StorageModule,
    QueueModule,
    VocabularyModule,
    SuggestModule.register({ withProvider: false }),
    AuthModule,
    DocumentsModule,
    SearchModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
