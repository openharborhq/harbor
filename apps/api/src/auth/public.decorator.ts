import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "tw:public";
/** Marks a route reachable without a verified session (sign-in steps, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
