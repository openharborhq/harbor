import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import {
  CreateCategory,
  CreatePerson,
  UpdatePerson,
  UpsertKeyDocument,
  type Category,
  type DocumentSummary,
  type KeyDocumentSlot,
  type Person,
  type SessionUser,
} from "@trustworthier/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { ZodPipe } from "../common/zod.pipe";
import { DocumentsService } from "../documents/documents.service";
import { CategoriesService } from "./categories.service";
import { PeopleService } from "./people.service";

@Controller()
export class VocabularyController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly people: PeopleService,
    private readonly documents: DocumentsService,
  ) {}

  @Get("categories")
  listCategories(): Promise<Category[]> {
    return this.categories.list();
  }

  @Post("categories")
  createCategory(@Body(new ZodPipe(CreateCategory)) body: CreateCategory, @CurrentUser() user: SessionUser): Promise<Category> {
    return this.categories.create(body, user.id);
  }

  @Get("people")
  listPeople(): Promise<Person[]> {
    return this.people.list();
  }

  @Post("people")
  createPerson(@Body(new ZodPipe(CreatePerson)) body: CreatePerson, @CurrentUser() user: SessionUser): Promise<Person> {
    return this.people.create(body, user.id);
  }

  /** Person page payload: the person, their key-document slots, and every document about them. */
  @Get("people/:id")
  async getPerson(@Param("id", ParseUUIDPipe) id: string): Promise<{ person: Person; keyDocuments: KeyDocumentSlot[]; documents: DocumentSummary[] }> {
    const [person, keyDocuments, documents] = await Promise.all([this.people.get(id), this.people.keyDocuments(id), this.documents.list({ personId: id, limit: 500 })]);
    return { person, keyDocuments, documents };
  }

  @Patch("people/:id")
  updatePerson(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdatePerson)) body: UpdatePerson, @CurrentUser() user: SessionUser): Promise<Person> {
    return this.people.update(id, body, user.id);
  }

  @Post("people/:id/key-documents")
  addKeyDocument(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(UpsertKeyDocument)) body: UpsertKeyDocument, @CurrentUser() user: SessionUser): Promise<KeyDocumentSlot[]> {
    return this.people.upsertKeyDocument(id, null, body, user.id);
  }

  @Patch("people/:id/key-documents/:slotId")
  setKeyDocument(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("slotId", ParseUUIDPipe) slotId: string,
    @Body(new ZodPipe(UpsertKeyDocument)) body: UpsertKeyDocument,
    @CurrentUser() user: SessionUser,
  ): Promise<KeyDocumentSlot[]> {
    return this.people.upsertKeyDocument(id, slotId, body, user.id);
  }

  @Delete("people/:id/key-documents/:slotId")
  removeKeyDocument(@Param("id", ParseUUIDPipe) id: string, @Param("slotId", ParseUUIDPipe) slotId: string, @CurrentUser() user: SessionUser): Promise<KeyDocumentSlot[]> {
    return this.people.removeKeyDocument(id, slotId, user.id);
  }
}
