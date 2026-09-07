import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Env } from "../config/env";
import { CryptoService } from "../crypto/crypto.service";

export interface SealedBlob {
  storageKey: string;
  iv: Buffer;
  authTag: Buffer;
  byteSize: number;
}

/**
 * Encrypted-at-rest file storage under $TW_DATA_DIR/blobs (spec §3.3).
 * Each file is AES-256-GCM under its own DEK; the DEK is wrapped by the KEK (CryptoService)
 * and stored in Postgres next to the IV and auth tag. The blob on disk is ciphertext only.
 * Blobs are never shared between documents; sha256 exists for duplicate *detection* (spec §2).
 */
@Injectable()
export class BlobStore implements OnModuleInit {
  readonly dataDir: string;
  readonly blobsDir: string;
  readonly tmpDir: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly crypto: CryptoService,
  ) {
    this.dataDir = config.get("TW_DATA_DIR", { infer: true });
    this.blobsDir = path.join(this.dataDir, "blobs");
    this.tmpDir = path.join(this.dataDir, "tmp");
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.blobsDir, { recursive: true, mode: 0o700 });
    await mkdir(this.tmpDir, { recursive: true, mode: 0o700 });
  }

  newTempPath(suffix = ""): string {
    return path.join(this.tmpDir, `${randomUUID()}${suffix}`);
  }

  /** Stream-hash a file without loading it into memory. */
  async sha256(file: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    return hash.digest("hex");
  }

  /**
   * Encrypt a plaintext file into a new blob. Writes to a temp name, fsyncs, then renames,
   * so a crash never leaves a half-written blob under a live key.
   */
  async sealFile(plaintextPath: string, dek: Buffer): Promise<SealedBlob> {
    const storageKey = randomUUID();
    const dest = this.pathFor(storageKey);
    await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    const partial = `${dest}.partial`;
    await pipeline(createReadStream(plaintextPath), cipher, createWriteStream(partial, { mode: 0o600 }));
    await this.fsync(partial);
    await rename(partial, dest);
    const { size } = await stat(plaintextPath);
    return { storageKey, iv, authTag: cipher.getAuthTag(), byteSize: size };
  }

  /** Decrypted stream of a blob. Errors at the end if the auth tag does not verify. */
  openStream(storageKey: string, dek: Buffer, iv: Buffer, authTag: Buffer): Readable {
    const decipher = createDecipheriv("aes-256-gcm", dek, iv);
    decipher.setAuthTag(authTag);
    const src = createReadStream(this.pathFor(storageKey));
    src.on("error", (err) => decipher.destroy(err));
    return src.pipe(decipher);
  }

  async openToFile(storageKey: string, dek: Buffer, iv: Buffer, authTag: Buffer, destPath: string): Promise<void> {
    await pipeline(this.openStream(storageKey, dek, iv, authTag), createWriteStream(destPath, { mode: 0o600 }));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
  }

  /** Wrap/unwrap a DEK under the KEK, bound to the blob it belongs to. */
  wrapDek(dek: Buffer, storageKey: string): Buffer {
    return this.crypto.seal(dek, Buffer.from(storageKey));
  }

  unwrapDek(dekWrapped: Buffer, storageKey: string): Buffer {
    return this.crypto.open(dekWrapped, Buffer.from(storageKey));
  }

  private pathFor(storageKey: string): string {
    if (!/^[0-9a-f-]{36}$/.test(storageKey)) throw new Error("Invalid storage key");
    return path.join(this.blobsDir, storageKey.slice(0, 2), storageKey);
  }

  private async fsync(file: string): Promise<void> {
    const fh = await open(file, "r");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  }
}
