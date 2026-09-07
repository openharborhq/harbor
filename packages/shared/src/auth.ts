import { z } from "zod/v4";

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

// ---- Settings: account & household (spec §3.5) ----

/** The name shown on the user card and beside each owner. One free-text field, not first/last:
 * plenty of names don't split that way, and the card only ever shows the whole thing. */
export const UpdateProfile = z.object({ displayName: z.string().trim().min(1).max(80) });
export type UpdateProfile = z.infer<typeof UpdateProfile>;

export const ChangePassword = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).max(200),
});
export type ChangePassword = z.infer<typeof ChangePassword>;

/** Sensitive actions re-authenticate with the password (spec §3.5). */
export const Reauth = z.object({ password: z.string().min(1) });
export type Reauth = z.infer<typeof Reauth>;

export const RecoveryCodesResult = z.object({ codes: z.array(z.string()) });
export type RecoveryCodesResult = z.infer<typeof RecoveryCodesResult>;

export const SessionInfo = z.object({
  id: z.string().uuid(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const OwnerInfo = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  totpEnabled: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  status: z.enum(["active", "disabled"]),
  isYou: z.boolean(),
  recoveryCodesLeft: z.number().int().nonnegative(),
});
export type OwnerInfo = z.infer<typeof OwnerInfo>;

export const CreateInvite = z.object({ email: z.string().email(), password: z.string().min(1) });
export type CreateInvite = z.infer<typeof CreateInvite>;

export const InviteInfo = z.object({
  id: z.string().uuid(),
  email: z.string(),
  createdBy: z.string().nullable(),
  expiresAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  /** Only present on the create response; never retrievable again. */
  url: z.string().optional(),
});
export type InviteInfo = z.infer<typeof InviteInfo>;

export const AcceptInvite = z.object({
  token: z.string().min(16),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(12).max(200),
});
export type AcceptInvite = z.infer<typeof AcceptInvite>;

export const AcceptInviteResult = z.object({ email: z.string(), otpauthUri: z.string(), recoveryCodes: z.array(z.string()) });
export type AcceptInviteResult = z.infer<typeof AcceptInviteResult>;
