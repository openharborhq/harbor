import { Module } from "@nestjs/common";
import { SearchIndexModule } from "../search/search-index.module";
import { FileProcessor } from "./file-processor.service";

@Module({ imports: [SearchIndexModule], providers: [FileProcessor], exports: [FileProcessor] })
export class ProcessingModule {}
