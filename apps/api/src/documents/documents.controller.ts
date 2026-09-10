import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { AcceptSuggestion, BulkDeleteDocuments, ListDocumentsQuery, UpdateDocument, parseUploadFields, type AcceptAllResult, type ActivityEntry, type DeletedDocument, type DocumentSummary, type DocumentText, type DocumentVersion, type InboxCount, type RecentDocument, type SessionUser, type UploadResult } from "@harbor/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { ZodPipe } from "../common/zod.pipe";
import { DocumentsService } from "./documents.service";

@Controller("documents")
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Multipart field `file`. Returns immediately; processing continues in the worker. */
  @Post()
  @UseInterceptors(FileInterceptor("file"))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<UploadResult> {
    if (!file) throw new BadRequestException("Send the document as a multipart field named `file`.");
    let fields;
    try {
      fields = parseUploadFields((req.body ?? {}) as Record<string, unknown>);
    } catch (err) {
      throw new BadRequestException(`Invalid upload fields: ${(err as Error).message}`);
    }
    return this.documents.ingest({ path: file.path, originalName: file.originalname, byteSize: file.size }, fields, { userId: user.id, ip: req.ip ?? null });
  }

  /** Pre-upload check so the UI can ask "add as new version, or skip?" before sending bytes. */
  @Get("duplicates")
  async duplicates(@Query("sha256") sha256: string): Promise<{ duplicateOf: UploadResult["duplicateOf"] }> {
    if (!/^[0-9a-f]{64}$/.test(sha256 ?? "")) throw new BadRequestException("sha256 must be 64 hex characters");
    return { duplicateOf: await this.documents.findDuplicate(sha256) };
  }

  @Get()
  list(@Query(new ZodPipe(ListDocumentsQuery)) q: ListDocumentsQuery): Promise<DocumentSummary[]> {
    return this.documents.list({ inboxOnly: q.inbox !== undefined, categoryId: q.category, itemIds: q.item ? [q.item] : undefined, source: q.source, sort: q.sort, limit: q.limit });
  }

  /** What the Inbox is holding. Declared before `:id`, like every other literal route here. */
  @Get("inbox-count")
  inboxCount(): Promise<InboxCount> {
    return this.documents.inboxCount();
  }

  /** Documents this owner opened lately, most recent first. Declared before `:id` on purpose. */
  @Get("recent")
  recent(@CurrentUser() user: SessionUser): Promise<RecentDocument[]> {
    return this.documents.recent(user.id);
  }

  /** Files every high-confidence, unresolved Inbox suggestion. */
  @Post("accept-all")
  @HttpCode(200)
  acceptAll(@CurrentUser() user: SessionUser, @Req() req: Request): Promise<AcceptAllResult> {
    return this.documents.acceptAll(user.id, req.ip ?? null);
  }

  @Get("deleted")
  listDeleted(): Promise<DeletedDocument[]> {
    return this.documents.listDeleted();
  }

  @Get(":id")
  async get(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<DocumentSummary> {
    const doc = await this.documents.get(id);
    // Opening a document is what makes it recent. Awaited on purpose: the sidebar refetches the
    // moment this page commits, and a fire-and-forget write leaves it one navigation behind.
    // recordView swallows its own failures, so this can slow the read but never break it.
    await this.documents.recordView(id, user.id);
    return doc;
  }

  @Get(":id/thumbnail")
  async thumbnail(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const t = await this.documents.openThumbnail(id);
    if (!t) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("ETag", `"${t.fileId}"`);
    t.stream.on("error", () => {
      if (!res.headersSent) res.status(500);
      res.end();
    });
    t.stream.pipe(res);
  }

  /** Declared before ":id" routes so "bulk-delete" is not read as a document id. */
  @Post("bulk-delete")
  @HttpCode(200)
  bulkDelete(
    @Body(new ZodPipe(BulkDeleteDocuments)) body: BulkDeleteDocuments,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<{ deleted: number }> {
    return this.documents.bulkSoftDelete(body.ids, user.id, req.ip ?? null);
  }

  @Post(":id/reprocess")
  @HttpCode(200)
  reprocess(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<DocumentSummary> {
    return this.documents.reprocess(id, user.id, req.ip ?? null);
  }

  @Get(":id/text")
  text(@Param("id", ParseUUIDPipe) id: string): Promise<DocumentText> {
    return this.documents.text(id);
  }

  @Get(":id/versions")
  versions(@Param("id", ParseUUIDPipe) id: string): Promise<DocumentVersion[]> {
    return this.documents.versions(id);
  }

  @Get(":id/activity")
  activity(@Param("id", ParseUUIDPipe) id: string): Promise<ActivityEntry[]> {
    return this.documents.activity(id);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<void> {
    await this.documents.softDelete(id, user.id, req.ip ?? null);
  }

  @Post(":id/restore")
  @HttpCode(200)
  restore(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<DocumentSummary> {
    return this.documents.restore(id, user.id, req.ip ?? null);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateDocument)) body: UpdateDocument,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<DocumentSummary> {
    return this.documents.update(id, body, user.id, req.ip ?? null);
  }

  @Post(":id/suggestion/accept")
  @HttpCode(200)
  accept(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(AcceptSuggestion)) body: AcceptSuggestion,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<DocumentSummary> {
    return this.documents.acceptSuggestion(id, user.id, req.ip ?? null, body);
  }

  @Post(":id/suggestion/reject")
  @HttpCode(200)
  reject(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<DocumentSummary> {
    return this.documents.rejectSuggestion(id, user.id, req.ip ?? null);
  }

  @Get(":id/file")
  async file(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("version") version: string | undefined,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const v = version ? Number.parseInt(version, 10) : undefined;
    if (version && (!Number.isInteger(v) || v! < 1)) throw new BadRequestException("version must be a positive integer");
    const { stream, filename, mimeType, byteSize } = await this.documents.openOriginal(id, user.id, req.ip ?? null, v);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", String(byteSize));
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Cache-Control", "private, no-store");
    stream.on("error", () => {
      if (!res.headersSent) res.status(500);
      res.end();
    });
    stream.pipe(res);
  }
}
