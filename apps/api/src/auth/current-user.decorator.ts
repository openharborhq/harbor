import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { SessionUser } from "@harbor/shared";

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): SessionUser => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.user) throw new Error("CurrentUser used on a route without SessionGuard");
  return req.user;
});
