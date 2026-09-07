import { Global, Module } from "@nestjs/common";
import { BlobStore } from "./blob-store.service";

@Global()
@Module({ providers: [BlobStore], exports: [BlobStore] })
export class StorageModule {}
