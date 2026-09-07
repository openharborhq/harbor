import { Module } from "@nestjs/common";
import { FileProcessor } from "./file-processor.service";

@Module({ providers: [FileProcessor], exports: [FileProcessor] })
export class ProcessingModule {}
