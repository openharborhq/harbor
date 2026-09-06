import { z } from "zod";

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const TotpRequest = z.object({
  /** Six digits from the authenticator, or a recovery code. */
  code: z.string().min(6).max(32),
});
export type TotpRequest = z.infer<typeof TotpRequest>;

export const SessionUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
});
export type SessionUser = z.infer<typeof SessionUser>;
