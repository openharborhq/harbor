import { Global, Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { CategoriesService } from "./categories.service";
import { PeopleService } from "./people.service";
import { TagsService } from "./tags.service";
import { VocabularyController } from "./vocabulary.controller";

@Global()
@Module({
  imports: [forwardRef(() => DocumentsModule)],
  controllers: [VocabularyController],
  providers: [CategoriesService, PeopleService, TagsService],
  exports: [CategoriesService, PeopleService, TagsService],
})
export class VocabularyModule implements OnModuleInit {
  constructor(private readonly categories: CategoriesService) {}
  async onModuleInit(): Promise<void> {
    await this.categories.ensureDefaults();
  }
}
