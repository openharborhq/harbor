import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./health/health.controller";
import { loadEnv } from "./config/env";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Validate once; downstream services inject a typed Env instead of reading process.env.
      validate: (config) => loadEnv(config as NodeJS.ProcessEnv),
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
