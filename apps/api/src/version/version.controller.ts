import { Controller, Get } from "@nestjs/common";
import type { ReleaseNotes, VersionInfo } from "@harbor/shared";
import { VersionService } from "./version.service";

/** Owners only: what is deployed here, and whether something newer exists. */
@Controller("version")
export class VersionController {
  constructor(private readonly version: VersionService) {}

  @Get()
  info(): Promise<VersionInfo> {
    return this.version.info();
  }

  /** What changed in each release, so "should I upgrade?" can be answered on the page that asks. */
  @Get("releases")
  releases(): Promise<ReleaseNotes> {
    return this.version.releases();
  }
}
