import { Global, Module } from "@nestjs/common";
import { CryptoModule } from "../crypto/crypto.module";
import { DocumentSettingsService } from "./document-settings.service";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import { ShareBucketSettingsService } from "./share-bucket-settings.service";
import { SuggestionSettingsService } from "./suggestion-settings.service";

/** Global: the suggester resolves its provider from here on every job, and so does the share sink. */
@Global()
@Module({
  imports: [CryptoModule],
  controllers: [SettingsController],
  providers: [SettingsService, SuggestionSettingsService, ShareBucketSettingsService, DocumentSettingsService],
  exports: [SettingsService, SuggestionSettingsService, ShareBucketSettingsService],
})
export class SettingsModule {}
