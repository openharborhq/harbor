import { Global, Module, OnModuleInit } from "@nestjs/common";
import { CategoriesService } from "./categories.service";
import { PeopleService } from "./people.service";
import { VocabularyController } from "./vocabulary.controller";

@Global()
@Module({
  controllers: [VocabularyController],
  providers: [CategoriesService, PeopleService],
  exports: [CategoriesService, PeopleService],
})
export class VocabularyModule implements OnModuleInit {
  constructor(private readonly categories: CategoriesService) {}
  async onModuleInit(): Promise<void> {
    await this.categories.ensureDefaults();
  }
}
