import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";
import path from "node:path";
import { AVATAR } from "@harbor/shared";
import type { Env } from "../config/env";
import { ItemAvatarController } from "./item-avatar.controller";
import { ItemAvatarService } from "./item-avatar.service";

/**
 * Photographs, and nothing else. Imported by the API alone.
 *
 * This is the module that needs a data volume and an upload parser, and it is separate precisely
 * so that the worker, suggester, mailfetch and backup processes — which have neither — do not
 * have to carry it. Multer builds its disk storage the moment the module initialises, so merely
 * being in the graph is enough to kill a process with no /data.
 */
@Module({
  imports: [
    // A far smaller ceiling than a document's: a square the browser has already cropped is tens
    // of kilobytes, and nothing about a photo justifies 200 MB.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        dest: path.join(config.get("HARBOR_DATA_DIR", { infer: true }), "tmp"),
        limits: { fileSize: AVATAR.maxBytes, files: 1 },
      }),
    }),
  ],
  controllers: [ItemAvatarController],
  providers: [ItemAvatarService],
})
export class ItemAvatarModule {}
