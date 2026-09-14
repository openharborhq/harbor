import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/**
 * Passwords on a share link — **scrypt, not argon2**, and that is a deliberate difference from
 * how account passwords are hashed (`auth.service.ts`).
 *
 * The verifier is the doorman, and the doorman is meant to be the least interesting process on
 * the box: no database, no KEK, and no native dependencies that would give it a build toolchain
 * and a supply chain of its own. `node:crypto` has scrypt built in; argon2 is a native module.
 * Account passwords guard everything and keep argon2id; a share password guards one bundle that
 * is already expiring, and is checked behind a hard rate limit.
 *
 * Format: `scrypt$N$r$p$salt$hash`, all base64 — self-describing, so parameters can be raised
 * later without invalidating links that are already out.
 */
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 96 * 1024 * 1024;

export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifySharePassword(encoded: string, password: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  const actual = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
