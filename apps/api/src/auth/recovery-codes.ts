import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity on paper
export const RECOVERY_CODE_COUNT = 10;

/** e.g. "K7QX-M3ND-A8F2" — 60 bits of entropy, typed from a printed sheet. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHABET[bytes[i]! % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

/** Codes are random and high-entropy, so an unsalted SHA-256 is an adequate at-rest form. */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  return { codes, hashes: codes.map(hashRecoveryCode) };
}
