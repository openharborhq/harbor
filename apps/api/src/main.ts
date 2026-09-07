import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "@nestjs/common";
import { runMigrations, type Db } from "@trustworthier/db";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { DB } from "./db/db.module";

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set("trust proxy", "loopback"); // req.ip is real behind the compose/web proxy on the same host

  await runMigrations(app.get<Db>(DB));
  Logger.log("migrations applied", "bootstrap");

  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
  Logger.log(`API listening on :${env.API_PORT}`, "bootstrap");
}
void bootstrap();
