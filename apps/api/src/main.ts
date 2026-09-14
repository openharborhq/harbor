import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "@nestjs/common";
import { runMigrations, type Db } from "@harbor/db";
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

  /**
   * The API is reached through the web app's same-origin /api rewrite, so its responses inherit
   * that app's headers (next.config.ts). These are the ones that must not depend on the proxy
   * being in front: a JSON body should never be sniffed into something executable, framed, or
   * cached by anything in between (spec §3.2).
   */
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    next();
  });
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
  Logger.log(`API listening on :${env.API_PORT}`, "bootstrap");
}
void bootstrap();
