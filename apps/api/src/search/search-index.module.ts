import { Module } from "@nestjs/common";
import { SearchIndexService } from "./search-index.service";

/** Split out of SearchModule so vocabulary and documents can reindex without pulling in the controller. */
@Module({ providers: [SearchIndexService], exports: [SearchIndexService] })
export class SearchIndexModule {}
