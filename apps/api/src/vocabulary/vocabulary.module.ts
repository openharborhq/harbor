import { Global, Module, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";
import path from "node:path";
import { AVATAR } from "@harbor/shared";
import type { Env } from "../config/env";
import { SearchIndexModule } from "../search/search-index.module";
import { CategoriesService } from "./categories.service";
import { ItemsService } from "./items.service";
import { TagsService } from "./tags.service";
import { VocabularyController } from "./vocabulary.controller";

@Global()
@Module({
  imports: [
    SearchIndexModule,
    // Its own registration, and a far smaller ceiling than a document's: a square the browser has
    // already cropped is tens of kilobytes, and nothing about a photo justifies 200 MB.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        dest: path.join(config.get("HARBOR_DATA_DIR", { infer: true }), "tmp"),
        limits: { fileSize: AVATAR.maxBytes, files: 1 },
      }),
    }),
  ],
  controllers: [VocabularyController],
  providers: [CategoriesService, ItemsService, TagsService],
  exports: [CategoriesService, ItemsService, TagsService],
})
export class VocabularyModule implements OnModuleInit {
  constructor(private readonly categories: CategoriesService) {}
  async onModuleInit(): Promise<void> {
    await this.categories.ensureDefaults();
  }
}
