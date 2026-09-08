import { Global, Module } from "@nestjs/common";
import { CryptoModule } from "../crypto/crypto.module";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import { SuggestionSettingsService } from "./suggestion-settings.service";

/** Global: the suggester resolves its provider from here on every job. */
@Global()
@Module({
  imports: [CryptoModule],
  controllers: [SettingsController],
  providers: [SettingsService, SuggestionSettingsService],
  exports: [SettingsService, SuggestionSettingsService],
})
export class SettingsModule {}
