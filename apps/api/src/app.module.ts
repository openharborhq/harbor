import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { loadEnv } from "./config/env";
import { CryptoModule } from "./crypto/crypto.module";
import { DbModule } from "./db/db.module";
import { HealthController } from "./health/health.controller";

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
    AuthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
