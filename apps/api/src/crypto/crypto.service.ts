import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Env } from "../config/env";

const IV_BYTES = 12;
const TAG_BYTES = 16;
export const KEY_BYTES = 32;
/** Bumped when the KEK is rotated; stored next to every wrapped secret (spec §3.3). */
export const CURRENT_KEY_VERSION = 1;

/**
 * Key-encryption-key operations. The KEK is read once from HARBOR_KEK_FILE (a Docker secret in
 * production) and never leaves this process. Everything sensitive at rest — per-file DEKs,
 * TOTP secrets — is sealed with AES-256-GCM under it.
 */
@Injectable()
export class CryptoService {
  private readonly kek: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.kek = CryptoService.loadKek(config.get("HARBOR_KEK_FILE", { infer: true }));
  }

  static loadKek(file: string): Buffer {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8").trim();
    } catch (err) {
      throw new Error(`Cannot read the master key file at ${file}. Run \`setup\` first, or check HARBOR_KEK_FILE. (${(err as Error).message})`);
    }
    const key = Buffer.from(raw, "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(`Master key file ${file} must contain a base64-encoded ${KEY_BYTES}-byte key (got ${key.length} bytes).`);
    }
    return key;
  }

  static generateKek(): string {
    return randomBytes(KEY_BYTES).toString("base64");
  }

  /** Random 256-bit data-encryption key for one file. */
  generateDek(): Buffer {
    return randomBytes(KEY_BYTES);
  }

  /** Seal under the KEK. Output layout: iv(12) || tag(16) || ciphertext. */
  seal(plaintext: Buffer, aad?: Buffer): Buffer {
    return sealWith(this.kek, plaintext, aad);
  }

  open(sealed: Buffer, aad?: Buffer): Buffer {
    return openWith(this.kek, sealed, aad);
  }

  sealString(plaintext: string): string {
    return `v${CURRENT_KEY_VERSION}.${this.seal(Buffer.from(plaintext, "utf8")).toString("base64")}`;
  }

  openString(sealed: string): string {
    const [version, payload] = sealed.split(".");
    if (version !== `v${CURRENT_KEY_VERSION}` || !payload) throw new Error("Unknown sealed-string version");
    return this.open(Buffer.from(payload, "base64")).toString("utf8");
  }

  /** Opaque random token for sessions etc. URL-safe. */
  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString("base64url");
  }

  /** Tokens are stored hashed so a database leak doesn't yield live sessions. */
  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  constantTimeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}

export function sealWith(key: Buffer, plaintext: Buffer, aad?: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function openWith(key: Buffer, sealed: Buffer, aad?: Buffer): Buffer {
  if (sealed.length < IV_BYTES + TAG_BYTES) throw new Error("Sealed payload too short");
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = sealed.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
