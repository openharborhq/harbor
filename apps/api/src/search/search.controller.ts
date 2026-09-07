import { Controller, Get, Query } from "@nestjs/common";
import { SearchQuery, type SearchResponse } from "@harbor/shared";
import { ZodPipe } from "../common/zod.pipe";
import { SearchService } from "./search.service";

@Controller("search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  run(@Query(new ZodPipe(SearchQuery)) query: SearchQuery): Promise<SearchResponse> {
    return this.search.search(query);
  }
}
