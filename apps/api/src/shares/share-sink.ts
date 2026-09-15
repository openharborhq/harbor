import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
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
  private readonly log = new Logger(DoormanSink.name);
  readonly kind = "doorman" as const;
  readonly root: string;
  /**
   * Separate from `root`, and deliberately so: the doorman mounts the share directory **read-only**
   * and must have exactly one path it can write. That path is its own, and the vault only ever
   * reads it.
   */
  readonly stateRoot: string;

  constructor(config: ConfigService<Env, true>) {
    const data = config.get("HARBOR_DATA_DIR", { infer: true });
    this.root = path.join(data, "shares");
    this.stateRoot = path.join(data, "share-state");
  }

  /**
   * Best effort, and never fatal.
   *
   * These directories are bind mounts. On a volume prepared by `check-data-volume.sh` they exist
   * and belong to the right user; on one where Docker created them itself they belong to root, and
   * `mkdir` from a container running as `node` fails with EACCES. That used to throw here, which
   * took the whole API down at boot — the vault refusing to start because an optional feature
   * could not make a folder. Sharing is the only thing that needs these, so sharing is the only
   * thing that should fail without them.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDirs();
    } catch (err) {
      this.log.warn(`Sharing is unavailable: ${(err as Error).message}. Everything else is unaffected.`);
    }
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(path.join(this.root, "bundles"), { recursive: true, mode: 0o700 });
    await mkdir(path.join(this.root, "links"), { recursive: true, mode: 0o700 });
    await mkdir(this.stateRoot, { recursive: true, mode: 0o700 });
  }

  /** Called before a share is sealed, so the failure lands on that request and says what to do. */
  async assertWritable(): Promise<void> {
    try {
      await this.ensureDirs();
    } catch (err) {
      throw new Error(
        `Sharing cannot write to ${this.root} (${(err as Error).message}). The data volume is missing its share directories, ` +
          "or they belong to another user — re-run install.sh over this install, which creates them.",
      );
    }
  }

  /**
   * Refuse to seal a share into a directory that is not the data volume.
   *
   * The failure this exists for: a box that took new images without refreshing its compose files —
   * possible on any install made before `harbor upgrade` learned to do that — has no `/data/shares`
   * mount. The API container is not read-only, so the writes *succeed*, into its own ephemeral
   * layer. Shares would appear to be created, their links would point at a doorman that does not
   * exist, and the bundles would vanish on the next restart. Silence is the worst outcome here.
   *
   * The test is whether the share directory is on the same filesystem as the blob store, which is
   * unambiguously the data volume: a bind mount and a container layer never share a device.
   */
  async assertOnDataVolume(blobsDir: string): Promise<void> {
    const [blobs, shares] = await Promise.all([stat(blobsDir), stat(this.root)]);
    if (blobs.dev !== shares.dev) {
      throw new Error(
        "Sharing is not set up on this appliance: /data/shares is not part of the data volume, so a share would be lost on the next restart. " +
          "This happens when new images arrive without the compose files that go with them — run `harbor upgrade` again, or re-run install.sh over this install.",
      );
    }
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

  /**
   * Where to seal a bundle so that putting it away is a rename and not a copy.
   *
   * `/data/tmp` and `/data/shares` are the same filesystem but **different bind mounts**, and
   * Linux refuses `rename(2)` across a mount boundary whatever is underneath — `EXDEV: cross-device
   * link not permitted`, which is what every share on the appliance failed with (2026-09-15). The
   * device check in `assertOnDataVolume` cannot catch it: both mounts report the same `st_dev`,
   * because it is genuinely one volume.
   *
   * So the seal is written where it is going to live. A dotted name, and under `bundles/` rather
   * than beside it: the doorman only ever reads `bundles/<uuid>/bundle`, so a half-written file
   * here is invisible to it.
   */
  newStagingPath(): string {
    return path.join(this.root, "bundles", `.staging-${randomUUID()}`);
  }

  /** Move a finished bundle into place and drop the key beside it. */
  async putBundle(shareId: string, sealedTempPath: string, key: Buffer): Promise<void> {
    const dir = this.bundleDir(shareId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      await rename(sealedTempPath, this.bundlePath(shareId));
    } catch (err) {
      // `newStagingPath` keeps the rename inside one mount, so this should not happen. It stays
      // because the cost of being wrong is a 500 on a share someone is trying to send, and a
      // mount layout is not something this code gets to decide: an owner who binds the share
      // directory somewhere else is not doing anything unreasonable. Copy, then drop the source,
      // which is what `finally` upstream would have done with it anyway.
      if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      this.log.warn(`${sealedTempPath} and ${dir} are different mounts; copying the bundle instead of moving it.`);
      await copyFile(sealedTempPath, this.bundlePath(shareId));
      await rm(sealedTempPath, { force: true });
    }
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

  /**
   * The doorman's own state for one link, keyed by the same token hash it looks policies up by.
   * Read to fold download counts back into the database; never written from here.
   */
  stateDir(tokenHash: string): string {
    return path.join(this.stateRoot, tokenHash);
  }

  /** State for every link of a share is discarded with it. */
  async deleteState(tokenHash: string): Promise<void> {
    await rm(this.stateDir(tokenHash), { recursive: true, force: true });
  }
}

/** Directory name for a token. Same hash the doorman computes from what the recipient presents. */
export function tokenDirName(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
