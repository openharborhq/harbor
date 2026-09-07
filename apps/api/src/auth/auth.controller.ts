import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  AcceptInvite,
  ChangePassword,
  CreateInvite,
  LoginRequest,
  Reauth,
  TotpRequest,
  UpdateProfile,
  type AcceptInviteResult,
  type InviteInfo,
  type OwnerInfo,
  type RecoveryCodesResult,
  type SessionInfo,
  type SessionUser,
} from "@trustworthier/shared";
import { ZodPipe } from "../common/zod.pipe";
import { AuthService, SESSION_COOKIE, type RequestMeta } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { Public } from "./public.decorator";

function meta(req: Request): RequestMeta {
  return { ip: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Step 1. On success sets a pending session cookie; the client must then POST /auth/totp. */
  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body(new ZodPipe(LoginRequest)) body: LoginRequest, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token } = await this.auth.login(body.email, body.password, meta(req));
    res.cookie(SESSION_COOKIE, token, this.auth.cookieOptions());
    return { next: "totp" as const };
  }

  /** Step 2. Six-digit authenticator code or a recovery code. */
  @Public()
  @Post("totp")
  @HttpCode(200)
  async totp(@Body(new ZodPipe(TotpRequest)) body: TotpRequest, @Req() req: Request): Promise<{ user: SessionUser }> {
    if (!req.session) throw new UnauthorizedException("Start by signing in with your password.");
    const user = await this.auth.verifySecondFactor(req.session, body.code, meta(req));
    return { user };
  }

  @Get("me")
  me(@CurrentUser() user: SessionUser): { user: SessionUser } {
    return { user };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    if (req.session) await this.auth.logout(req.session, meta(req));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  // ---- account ----

  @Patch("profile")
  updateProfile(@Body(new ZodPipe(UpdateProfile)) body: UpdateProfile, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<SessionUser> {
    return this.auth.updateProfile(user.id, body.displayName, meta(req));
  }

  @Post("password")
  @HttpCode(204)
  async changePassword(@Body(new ZodPipe(ChangePassword)) body: ChangePassword, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<void> {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword, meta(req));
  }

  @Post("recovery-codes")
  @HttpCode(200)
  async recoveryCodes(@Body(new ZodPipe(Reauth)) body: Reauth, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<RecoveryCodesResult> {
    return { codes: await this.auth.regenerateRecoveryCodes(user.id, body.password, meta(req)) };
  }

  @Get("sessions")
  sessions(@CurrentUser() user: SessionUser, @Req() req: Request): Promise<SessionInfo[]> {
    return this.auth.listSessions(user.id, req.session!.id);
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  async revoke(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<void> {
    await this.auth.revokeSession(user.id, id, meta(req));
  }

  // ---- household ----

  @Get("owners")
  owners(@CurrentUser() user: SessionUser): Promise<OwnerInfo[]> {
    return this.auth.listOwners(user.id);
  }

  @Get("invites")
  invites(): Promise<InviteInfo[]> {
    return this.auth.listInvites();
  }

  @Post("invites")
  @HttpCode(201)
  createInvite(@Body(new ZodPipe(CreateInvite)) body: CreateInvite, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<InviteInfo> {
    return this.auth.createInvite(body.email, user.id, body.password, meta(req));
  }

  @Public()
  @Get("invites/check")
  async checkInvite(@Query("token") token: string): Promise<{ valid: boolean; email?: string }> {
    const r = token ? await this.auth.checkInvite(token) : null;
    return r ? { valid: true, email: r.email } : { valid: false };
  }

  @Public()
  @Post("invites/accept")
  @HttpCode(201)
  acceptInvite(@Body(new ZodPipe(AcceptInvite)) body: AcceptInvite, @Req() req: Request): Promise<AcceptInviteResult> {
    return this.auth.acceptInvite(body.token, body.displayName, body.password, meta(req));
  }
}
