import { BadRequestException, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { Item, SessionUser } from "@harbor/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { ItemAvatarService } from "./item-avatar.service";

/** Photographs of people and things. Only the API serves these; see ItemAvatarService. */
@Controller()
export class ItemAvatarController {
  constructor(private readonly avatars: ItemAvatarService) {}

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
    return this.avatars.setAvatar(id, { path: file.path, byteSize: file.size }, user.id);
  }

  @Delete("items/:id/avatar")
  removeAvatar(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<Item> {
    return this.avatars.removeAvatar(id, user.id);
  }

  /** Decrypted on the way out, and never cached anywhere but this browser. */
  @Get("items/:id/avatar")
  async avatar(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const photo = await this.avatars.openAvatar(id);
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
}
