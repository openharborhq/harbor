import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";
import path from "node:path";
import type { Env } from "../config/env";
import { SearchIndexModule } from "../search/search-index.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { ItemPageController } from "./item-page.controller";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // matches the drop-zone copy in the design

@Module({
  imports: [
    SearchIndexModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      // Plaintext lands in $TW_DATA_DIR/tmp (on the encrypted volume) and is deleted by DocumentsService.
      useFactory: (config: ConfigService<Env, true>) => ({
        dest: path.join(config.get("TW_DATA_DIR", { infer: true }), "tmp"),
        limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      }),
    }),
  ],
  controllers: [DocumentsController, ItemPageController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
