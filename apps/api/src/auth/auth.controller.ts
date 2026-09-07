import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { LoginRequest, TotpRequest, type SessionUser } from "@trustworthier/shared";
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
  async login(
    @Body(new ZodPipe(LoginRequest)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
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
}
