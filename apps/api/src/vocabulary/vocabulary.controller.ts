import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import {
  CreateCategory,
  CreateItem,
  ItemKind,
  RenameCategory,
  UpdateItem,
  UpsertKeyDocument,
  type Category,
  type Item,
  type KeyDocumentSlot,
  type SessionUser,
} from "@trustworthier/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { ZodPipe } from "../common/zod.pipe";
import { CategoriesService } from "./categories.service";
import { ItemsService } from "./items.service";

@Controller()
export class VocabularyController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly items: ItemsService,
  ) {}

  @Get("categories")
  listCategories(): Promise<Category[]> {
    return this.categories.list();
  }

  @Post("categories")
  createCategory(@Body(new ZodPipe(CreateCategory)) body: CreateCategory, @CurrentUser() user: SessionUser): Promise<Category> {
    return this.categories.create(body, user.id);
  }

  @Patch("categories/:id")
  renameCategory(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RenameCategory)) body: RenameCategory,
    @CurrentUser() user: SessionUser,
  ): Promise<Category> {
    return this.categories.rename(id, body.name, user.id);
  }

  /** `?kind=person` or `?kind=property,vehicle,account`. Omit for everything. */
  @Get("items")
  listItems(@Query("kind") kind?: string): Promise<Item[]> {
    const kinds = kind
      ?.split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .map((k) => ItemKind.parse(k));
    return this.items.list(kinds);
  }

  @Post("items")
  createItem(@Body(new ZodPipe(CreateItem)) body: CreateItem, @CurrentUser() user: SessionUser): Promise<Item> {
    return this.items.create(body, user.id);
  }

  @Patch("items/:id")
  updateItem(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateItem)) body: UpdateItem, @CurrentUser() user: SessionUser): Promise<Item> {
    return this.items.update(id, body, user.id);
  }

  @Post("items/:id/key-documents")
  addKeyDocument(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpsertKeyDocument)) body: UpsertKeyDocument,
    @CurrentUser() user: SessionUser,
  ): Promise<KeyDocumentSlot[]> {
    return this.items.upsertKeyDocument(id, null, body, user.id);
  }

  @Patch("items/:id/key-documents/:slotId")
  setKeyDocument(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("slotId", ParseUUIDPipe) slotId: string,
    @Body(new ZodPipe(UpsertKeyDocument)) body: UpsertKeyDocument,
    @CurrentUser() user: SessionUser,
  ): Promise<KeyDocumentSlot[]> {
    return this.items.upsertKeyDocument(id, slotId, body, user.id);
  }

  @Delete("items/:id/key-documents/:slotId")
  removeKeyDocument(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("slotId", ParseUUIDPipe) slotId: string,
    @CurrentUser() user: SessionUser,
  ): Promise<KeyDocumentSlot[]> {
    return this.items.removeKeyDocument(id, slotId, user.id);
  }
}
