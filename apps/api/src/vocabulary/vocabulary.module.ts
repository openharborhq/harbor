import { Global, Module, OnModuleInit } from "@nestjs/common";
import { SearchIndexModule } from "../search/search-index.module";
import { CategoriesService } from "./categories.service";
import { ItemsService } from "./items.service";
import { TagsService } from "./tags.service";
import { VocabularyController } from "./vocabulary.controller";

@Global()
@Module({
  imports: [SearchIndexModule],
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
