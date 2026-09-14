import { Body, Controller, Get, Patch, Post } from "@nestjs/common";
import {
  SetShareDelivery,
  UpdateShareBucketSettings,
  UpdateSuggestionSettings,
  type ShareBucketSettings,
  type ShareBucketTestResult,
  type ShareDeliverySettings,
  type SuggestionSettings,
  type SuggestionTestResult,
} from "@harbor/shared";
import { ZodPipe } from "../common/zod.pipe";
import { ShareBucketSettingsService } from "./share-bucket-settings.service";
import { SuggestionSettingsService } from "./suggestion-settings.service";

/** Settings an owner changes in the browser instead of in a file over ssh (spec §3.7). */
@Controller("settings")
export class SettingsController {
  constructor(
    private readonly suggestions: SuggestionSettingsService,
    private readonly shareBucket: ShareBucketSettingsService,
  ) {}

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

  /** Which sink every share uses. A setting, not a per-share choice — it carries setup with it. */
  @Get("share-delivery")
  getShareDelivery(): Promise<ShareDeliverySettings> {
    return this.shareBucket.delivery();
  }

  @Patch("share-delivery")
  setShareDelivery(@Body(new ZodPipe(SetShareDelivery)) body: SetShareDelivery): Promise<ShareDeliverySettings> {
    return this.shareBucket.setDelivery(body.delivery);
  }

  @Get("share-bucket")
  getShareBucket(): Promise<ShareBucketSettings> {
    return this.shareBucket.view();
  }

  @Patch("share-bucket")
  updateShareBucket(@Body(new ZodPipe(UpdateShareBucketSettings)) body: UpdateShareBucketSettings): Promise<ShareBucketSettings> {
    return this.shareBucket.update(body);
  }

  /**
   * Writes a test object, reads it back through a signed link and deletes it — the three things a
   * share does, before anyone finds out from their accountant that one of them does not work.
   * Saves first, so the button tests what is stored rather than what is typed.
   */
  @Post("share-bucket/test")
  testShareBucket(): Promise<ShareBucketTestResult> {
    return this.shareBucket.test();
  }
}
