import { Injectable } from "@nestjs/common";
import type { DocumentSettings, UpdateDocumentSettings } from "@harbor/shared";
import { SETTING, SettingsService } from "./settings.service";

/**
 * How documents are handled when they arrive (spec §2 stage 1b). No environment fallback: the
 * default is the product's, not the installer's, and absent means on.
 */
@Injectable()
export class DocumentSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async view(): Promise<DocumentSettings> {
    return { photosToScans: (await this.settings.get(SETTING.photosToScans)) !== "false" };
  }

  async update(patch: UpdateDocumentSettings): Promise<DocumentSettings> {
    if (patch.photosToScans !== undefined) await this.settings.set(SETTING.photosToScans, String(patch.photosToScans));
    return this.view();
  }
}
