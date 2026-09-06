import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { loadEnv } from "./config/env";

/**
 * Second entrypoint for the same codebase (spec §3.7). Runs BullMQ processors only — no HTTP.
 * The container it ships in carries the OCR toolchain and has no internet egress (spec §3.6).
 * Processors are wired in milestone-1 step 7.
 */
async function bootstrap() {
  const env = loadEnv();
  Logger.log(`worker starting · OCR concurrency ${env.OCR_CONCURRENCY}`, "worker");
  const shutdown = (signal: string) => {
    Logger.log(`received ${signal}, draining`, "worker");
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
void bootstrap();
