import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import type { DocumentSummary, KeyDocumentSlot, Person } from "@trustworthier/shared";
import { PeopleService } from "../vocabulary/people.service";
import { DocumentsService } from "./documents.service";

/**
 * The person page needs people *and* documents. It lives in the documents module so the
 * (global) vocabulary module stays free of blob storage and queues — the suggester imports
 * vocabulary but must never be able to reach a document's bytes (spec §3.6).
 */
@Controller("people")
export class PersonPageController {
  constructor(
    private readonly people: PeopleService,
    private readonly documents: DocumentsService,
  ) {}

  @Get(":id")
  async getPerson(@Param("id", ParseUUIDPipe) id: string): Promise<{ person: Person; keyDocuments: KeyDocumentSlot[]; documents: DocumentSummary[] }> {
    const [person, keyDocuments, documents] = await Promise.all([
      this.people.get(id),
      this.people.keyDocuments(id),
      this.documents.list({ personId: id, limit: 500 }),
    ]);
    return { person, keyDocuments, documents };
  }
}
