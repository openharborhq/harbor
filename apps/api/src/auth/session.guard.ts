import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { parse as parseCookie } from "cookie";
import type { Request } from "express";
import { AuthService, SESSION_COOKIE } from "./auth.service";
import { IS_PUBLIC } from "./public.decorator";

/**
 * Registered globally (APP_GUARD). Every route requires a session whose second factor is
 * verified unless it is marked @Public(). Public routes still get req.session resolved so the
 * TOTP step can find its pending session.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = readSessionToken(req);
    const session = token ? await this.auth.resolveSession(token) : null;
    req.session = session;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    if (!session || !session.totpVerifiedAt) throw new UnauthorizedException("Sign in to continue.");
    req.user = session.user;
    return true;
  }
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  return parseCookie(header)[SESSION_COOKIE] ?? null;
}
