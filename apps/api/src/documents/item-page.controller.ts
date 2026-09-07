import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import type { DocumentSummary, Item, KeyDocumentSlot } from "@harbor/shared";
import { ItemsService } from "../vocabulary/items.service";
import { DocumentsService } from "./documents.service";

/**
 * The item page needs items *and* documents. It lives in the documents module so the (global)
 * vocabulary module stays free of blob storage and queues — the suggester imports vocabulary
 * but must never be able to reach a document's bytes (spec §3.6).
 */
@Controller("items")
export class ItemPageController {
  constructor(
    private readonly items: ItemsService,
    private readonly documents: DocumentsService,
  ) {}

  @Get(":id")
  async getItem(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ item: Item; children: Item[]; keyDocuments: KeyDocumentSlot[]; documents: DocumentSummary[] }> {
    const [item, children, keyDocuments] = await Promise.all([this.items.get(id), this.items.children(id), this.items.keyDocuments(id)]);
    // A document about the boiler is also about the house it sits in (spec §6).
    const ids = [id, ...children.map((c) => c.id)];
    const documents = await this.documents.list({ itemIds: ids, limit: 500 });
    return { item, children, keyDocuments, documents };
  }
}
