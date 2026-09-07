import {
  BadRequestException,
  Body,
  Controller,
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
import { UpdateDocument, parseUploadFields, type AcceptAllResult, type DocumentSummary, type SessionUser, type UploadResult } from "@trustworthier/shared";
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
    return this.documents.ingestUpload({ path: file.path, originalName: file.originalname, byteSize: file.size }, fields, user.id, req.ip ?? null);
  }

  /** Pre-upload check so the UI can ask "add as new version, or skip?" before sending bytes. */
  @Get("duplicates")
  async duplicates(@Query("sha256") sha256: string): Promise<{ duplicateOf: UploadResult["duplicateOf"] }> {
    if (!/^[0-9a-f]{64}$/.test(sha256 ?? "")) throw new BadRequestException("sha256 must be 64 hex characters");
    return { duplicateOf: await this.documents.findDuplicate(sha256) };
  }

  @Get()
  list(@Query("inbox") inbox?: string): Promise<DocumentSummary[]> {
    return this.documents.list({ inboxOnly: inbox === "1" || inbox === "true" });
  }

  /** Files every high-confidence, unresolved Inbox suggestion. */
  @Post("accept-all")
  @HttpCode(200)
  acceptAll(@CurrentUser() user: SessionUser, @Req() req: Request): Promise<AcceptAllResult> {
    return this.documents.acceptAll(user.id, req.ip ?? null);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<DocumentSummary> {
    return this.documents.get(id);
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
  accept(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<DocumentSummary> {
    return this.documents.acceptSuggestion(id, user.id, req.ip ?? null);
  }

  @Post(":id/suggestion/reject")
  @HttpCode(200)
  reject(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<DocumentSummary> {
    return this.documents.rejectSuggestion(id, user.id, req.ip ?? null);
  }

  @Get(":id/file")
  async file(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser, @Req() req: Request, @Res() res: Response): Promise<void> {
    const { stream, filename, mimeType, byteSize } = await this.documents.openOriginal(id, user.id, req.ip ?? null);
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
