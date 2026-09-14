import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../config/env";

/**
 * Where a sealed bundle goes once it exists (spec §10.10).
 *
 * `put` / `presign` / `delete` is the whole contract, and it is deliberately small: the seal
 * happens upstream and is byte-identical whichever sink serves the result, so swapping delivery
 * stays a config change rather than a rewrite.
 *
 * Only sinks that can serve **one object to an anonymous browser over HTTPS** qualify. SFTP, a
 * local disk and a restic REST server cannot, which is why the set of sinks is a subset of the
 * backup backends rather than the same list — see §10.10.
 */
export interface ShareSink {
  readonly kind: "doorman" | "bucket";
}

/** What the doorman needs to answer one request, and nothing more. */
export interface SharePolicy {
  shareId: string;
  /** Name the recipient's browser will save it as. */
  filename: string;
  expiresAt: string;
  /** NULL = unlimited. Counted as *completed* downloads (§10.7). */
  maxDownloads: number | null;
  passwordHash: string | null;
  message: string | null;
  fileCount: number;
  /** Where the content stops; everything after it is padding (§10.2). */
  sealedBytes: number;
}

/**
 * The local sink: the share directory the doorman mounts read-only.
 *
 * Layout differs from the sketch in §10.2 in one way that matters. A share has several links —
 * one per recipient — so keying the whole directory by token would mean a copy of the bundle per
 * recipient. Bundles are keyed by share, policies by token, and a policy names its bundle:
 *
 *   /data/shares/bundles/<shareId>/bundle          the sealed archive, padded
 *   /data/shares/bundles/<shareId>/key             the per-share key, raw
 *   /data/shares/links/<sha256(token)>/policy.json  expiry, limits, password hash
 *
 * The doorman still sees exactly this directory and nothing else: no database, no KEK, no route
 * that enumerates. Revoking deletes the policy and, for the last link, the bundle and its key —
 * so the next request is a 404 whatever is cached anywhere.
 */
@Injectable()
export class DoormanSink implements ShareSink, OnModuleInit {
  readonly kind = "doorman" as const;
  readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = path.join(config.get("HARBOR_DATA_DIR", { infer: true }), "shares");
  }

  async onModuleInit(): Promise<void> {
    await mkdir(path.join(this.root, "bundles"), { recursive: true, mode: 0o700 });
    await mkdir(path.join(this.root, "links"), { recursive: true, mode: 0o700 });
  }

  bundleDir(shareId: string): string {
    return path.join(this.root, "bundles", shareId);
  }

  bundlePath(shareId: string): string {
    return path.join(this.bundleDir(shareId), "bundle");
  }

  linkDir(tokenHash: string): string {
    return path.join(this.root, "links", tokenHash);
  }

  /** Move a finished bundle into place and drop the key beside it. */
  async putBundle(shareId: string, sealedTempPath: string, key: Buffer): Promise<void> {
    const dir = this.bundleDir(shareId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await rename(sealedTempPath, this.bundlePath(shareId));
    await writeFile(path.join(dir, "key"), key, { mode: 0o600 });
  }

  async putPolicy(tokenHash: string, policy: SharePolicy): Promise<void> {
    const dir = this.linkDir(tokenHash);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // Written whole, then renamed: the doorman re-reads this on every request and must never
    // catch it half-written.
    const tmp = path.join(dir, ".policy.json.partial");
    await writeFile(tmp, JSON.stringify(policy, null, 2), { mode: 0o600 });
    await rename(tmp, path.join(dir, "policy.json"));
  }

  async deletePolicy(tokenHash: string): Promise<void> {
    await rm(this.linkDir(tokenHash), { recursive: true, force: true });
  }

  async deleteBundle(shareId: string): Promise<void> {
    await rm(this.bundleDir(shareId), { recursive: true, force: true });
  }

  /** The doorman's own state, read to fold download counts back into the database. */
  stateDir(shareLinkId: string): string {
    return path.join(this.root, "state", shareLinkId);
  }
}

/** Directory name for a token. Same hash the doorman computes from what the recipient presents. */
export function tokenDirName(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
