import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
  Logger.log(`API listening on :${env.API_PORT}`, "bootstrap");
}
void bootstrap();
