import { Body, Controller, Get, Patch, Post } from "@nestjs/common";
import { UpdateSuggestionSettings, type SuggestionSettings, type SuggestionTestResult } from "@harbor/shared";
import { ZodPipe } from "../common/zod.pipe";
import { SuggestionSettingsService } from "./suggestion-settings.service";

/** Settings an owner changes in the browser instead of in a file over ssh (spec §3.7). */
@Controller("settings")
export class SettingsController {
  constructor(private readonly suggestions: SuggestionSettingsService) {}

  @Get("suggestions")
  get(): Promise<SuggestionSettings> {
    return this.suggestions.view();
  }

  @Patch("suggestions")
  update(@Body(new ZodPipe(UpdateSuggestionSettings)) body: UpdateSuggestionSettings): Promise<SuggestionSettings> {
    return this.suggestions.update(body);
  }

  /** Make a real call with these settings before anyone commits to them. */
  @Post("suggestions/test")
  test(@Body(new ZodPipe(UpdateSuggestionSettings)) body: UpdateSuggestionSettings): Promise<SuggestionTestResult> {
    return this.suggestions.test(body);
  }
}
