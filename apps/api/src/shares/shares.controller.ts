import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { CreateShareInput, type SessionUser } from "@harbor/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { ZodPipe } from "../common/zod.pipe";
import { SharesService } from "./shares.service";

/**
 * The owner's side of sharing (spec §10). Everything here sits behind the ordinary session guard;
 * what a recipient touches is a different process on a different origin, and has no route in
 * common with this one.
 */
@Controller("shares")
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  @Get()
  list() {
    return this.shares.list();
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.shares.get(id);
  }

  /**
   * The response carries each recipient's link **once**. Tokens are stored hashed, so this is the
   * only moment they exist in readable form — the interface has to put them in front of the owner
   * now, not offer to show them again later.
   */
  @Post()
  create(@Body(new ZodPipe(CreateShareInput)) body: CreateShareInput, @CurrentUser() user: SessionUser, @Req() req: Request) {
    return this.shares.create(body, user.id, req.ip ?? null);
  }

  @Post(":id/revoke")
  revoke(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser, @Req() req: Request) {
    return this.shares.revoke(id, user.id, req.ip ?? null);
  }
}
