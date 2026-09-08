import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import {
  CreateCategory,
  CreateItem,
  ItemKind,
  RenameCategory,
  ReorderCategories,
  UpdateItem,
  UpsertKeyDocument,
  type Category,
  type DeleteItemResult,
  type Item,
  type KeyDocumentSlot,
  type SessionUser,
} from "@harbor/shared";
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

  @Post("categories/reorder")
  reorderCategories(@Body(new ZodPipe(ReorderCategories)) body: ReorderCategories, @CurrentUser() user: SessionUser): Promise<Category[]> {
    return this.categories.reorder(body.ids, user.id);
  }

  @Delete("categories/:id")
  @HttpCode(204)
  async deleteCategory(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<void> {
    await this.categories.remove(id, user.id);
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

  /**
   * A photo for an item, as a multipart field named `file`.
   *
   * It is already square when it gets here — the browser crops it — so the API stores what it is
   * given rather than resizing, which is what lets this image carry no PDF or image parser at all
   * (spec §3.6). What it does insist on is that the bytes really are a JPEG, PNG or WebP.
   */
  @Post("items/:id/avatar")
  @UseInterceptors(FileInterceptor("file"))
  setAvatar(
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: SessionUser,
  ): Promise<Item> {
    if (!file) throw new BadRequestException("Send the photo as a multipart field named `file`.");
    return this.items.setAvatar(id, { path: file.path, byteSize: file.size }, user.id);
  }

  @Delete("items/:id/avatar")
  removeAvatar(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<Item> {
    return this.items.removeAvatar(id, user.id);
  }

  /** Decrypted on the way out, and never cached anywhere but this browser. */
  @Get("items/:id/avatar")
  async avatar(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const photo = await this.items.openAvatar(id);
    if (!photo) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", photo.mimeType);
    // The type is sniffed from the file itself on the way in; tell the browser not to guess again.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("ETag", `"${photo.version}"`);
    photo.stream.on("error", () => {
      if (!res.headersSent) res.status(500);
      res.end();
    });
    photo.stream.pipe(res);
  }

  @Delete("items/:id")
  deleteItem(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<DeleteItemResult> {
    return this.items.remove(id, user.id);
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
