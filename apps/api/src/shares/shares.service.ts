import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { documentFiles, documents, shareAccessLog, shareFiles, shareLinks, shares, users, type Db } from "@harbor/db";
import {
  CreateShareInput,
  SINK_CAPABILITIES,
  bundleFilenames,
  paddedSizeFor,
  shareStatus,
  type ShareAccessEvent,
} from "@harbor/shared";
import { randomBytes, createCipheriv, pbkdf2 as pbkdf2Cb } from "node:crypto";
import { promisify } from "node:util";
import { open, rm } from "node:fs/promises";
import { AuditService } from "../audit/audit.service";
import type { Env } from "../config/env";
import { CryptoService } from "../crypto/crypto.service";
import { DB } from "../db/db.module";
import { BlobStore } from "../storage/blob-store.service";
import { StoredZipWriter, hashSharePassword, sealBundle } from "@harbor/bundle";
import { ShareBucketSettingsService } from "../settings/share-bucket-settings.service";
import { BucketSink } from "./bucket-sink";
import { DoormanSink, tokenDirName } from "./share-sink";
import { Inject } from "@nestjs/common";

/**
 * Creating, listing and revoking shares (spec §10).
 *
 * The load-bearing method is `create`, and what makes it a *build* rather than a pointer is that
 * it reads plaintext once, under the KEK, and never lets any of it out again except sealed under
 * a key minted for that share alone. Everything downstream — the doorman, an object store — holds
 * only what one share contains.
 */
@Injectable()
export class SharesService {
  private readonly log = new Logger(SharesService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly crypto: CryptoService,
    private readonly blobs: BlobStore,
    private readonly doorman: DoormanSink,
    private readonly bucket: BucketSink,
    private readonly settings: ShareBucketSettingsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(input: CreateShareInput, userId: string, ip: string | null) {
    /**
     * Which sink serves this share is a setting, not something the person sending it chooses
     * (2026-09-14). Picking one carries a setup requirement with it, so it is decided once in
     * Settings; the review screen only states what the choice means.
     */
    const { delivery, ready, problem } = await this.settings.delivery();
    if (!ready) throw new BadRequestException(problem ?? "Sharing is not set up yet.");
    const caps = SINK_CAPABILITIES[delivery];

    // Capabilities differ per sink, and the client cannot be trusted to have honoured them.
    if (input.expiryHours > caps.maxExpiryHours) {
      throw new BadRequestException(
        delivery === "bucket"
          ? "Links from your own storage last at most 7 days."
          : "That is not one of the expiry options.",
      );
    }
    if (!caps.maxDownloads && input.recipients.some((r) => r.maxDownloads !== undefined)) {
      throw new BadRequestException("A download limit needs Harbor to serve the link — your storage cannot count downloads.");
    }

    // Cheap, and the alternative is a share that looks created and is already gone (§10.2).
    if (delivery === "doorman") {
      try {
        await this.doorman.assertWritable();
        await this.doorman.assertOnDataVolume(this.blobs.blobsDir);
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
    }

    const files = await this.filesFor(input.documentIds);
    const names = bundleFilenames(files.map((f) => ({ title: f.title, originalFilename: f.originalFilename })));
    const expiresAt = new Date(Date.now() + input.expiryHours * 3600_000);

    const shareKey = randomBytes(32);
    const zipTemp = this.blobs.newTempPath(".zip");
    // The sealed bundle is staged where its sink will want it. For the doorman that is inside the
    // share directory, so putting it away is a rename within one mount rather than across two —
    // see `DoormanSink.newStagingPath`. The bucket sink only reads the file, so the vault's own
    // temp directory is the right place for it, and it is the only one cleaned up by `finally`
    // either way.
    const sealedTemp = delivery === "doorman" ? this.doorman.newStagingPath() : this.blobs.newTempPath(".bundle");
    let plaintextBytes = 0;

    try {
      // 1. Pack the plaintext into one stored zip. This is the only moment a share's documents
      //    exist decrypted outside the vault's own blob store, and it is a file with 0600 on the
      //    encrypted volume, deleted in the `finally` below whatever happens.
      const zipHandle = await open(zipTemp, "w+", 0o600);
      try {
        const zip = new StoredZipWriter(zipHandle, new Date());
        for (const [i, file] of files.entries()) {
          const dek = this.blobs.unwrapDek(file.dekWrapped, file.storageKey);
          await zip.addFile(names[i], this.blobs.openStream(file.storageKey, dek, file.iv, file.authTag));
        }
        plaintextBytes = await zip.finish();
      } finally {
        await zipHandle.close();
      }

      // 2. Seal it, padded, so neither the doorman nor a store learns the true size.
      const padTo = paddedSizeFor(plaintextBytes + 4096);
      const readHandle = await open(zipTemp, "r");
      const sealedHandle = await open(sealedTemp, "w+", 0o600);
      let sealedBytes: number;
      try {
        ({ sealedBytes } = await sealBundle({
          source: readHandle.createReadStream(),
          plaintextLength: plaintextBytes,
          dest: sealedHandle,
          key: shareKey,
          padTo,
        }));
      } finally {
        await readHandle.close();
        await sealedHandle.close();
      }

      // 3. Rows first, so a bundle on disk always has a share that knows about it.
      const wrapped = this.crypto.seal(shareKey);
      const [share] = await this.db
        .insert(shares)
        .values({
          label: input.label,
          message: input.message ?? null,
          delivery,
          paddedSize: padTo,
          byteSize: plaintextBytes,
          fileCount: files.length,
          shareKeyWrapped: wrapped,
          // The wrapped blob carries its own iv and tag; the columns exist for the day a sink
          // needs them separately, and are filled from the same seal.
          iv: wrapped.subarray(0, 12),
          authTag: wrapped.subarray(12, 28),
          expiresAt,
          sealedAt: new Date(),
          createdBy: userId,
        })
        .returning();

      await this.db.insert(shareFiles).values(
        files.map((f, i) => ({
          shareId: share.id,
          documentId: f.documentId,
          documentFileId: f.id,
          filenameInBundle: names[i],
          sortOrder: i,
        })),
      );

      // 4. Hand the sealed bundle to the sink. Everything above this line was identical for both,
      //    which is the whole reason delivery can be chosen per share.
      const filename = `${slugForFile(input.label)}.zip`;
      let pageUrl: string | null = null;
      if (delivery === "bucket") {
        const published = await this.bucket.publish({
          shareId: share.id,
          sealedPath: sealedTemp,
          filename,
          fileCount: files.length,
          message: input.message ?? null,
          expiresAt,
          expiresInSeconds: input.expiryHours * 3600,
        });
        pageUrl = published.pageUrl;
        await this.db.update(shares).set({ objectKey: published.objectKey }).where(eq(shares.id, share.id));
      } else {
        await this.doorman.putBundle(share.id, sealedTemp, shareKey);
      }

      // 5. One token per recipient. The plaintext is returned once and never stored.
      const minted: { linkId: string; recipientLabel: string; url: string }[] = [];
      for (const recipient of input.recipients) {
        const token = this.crypto.randomToken(32);
        const tokenHash = this.crypto.hashToken(token);
        /**
         * On `doorman` the password is checked by a server, behind a rate limit, so a hash is
         * stored. On `bucket` there is no server to ask: the password instead *wraps the key* in
         * the fragment, so nothing about it is stored here at all (§10.10).
         */
        const passwordHash =
          delivery === "doorman" && recipient.password ? await hashSharePassword(recipient.password) : null;
        const [link] = await this.db
          .insert(shareLinks)
          .values({
            shareId: share.id,
            recipientLabel: recipient.label,
            tokenHash,
            passwordHash,
            maxDownloads: caps.maxDownloads ? (recipient.maxDownloads ?? null) : null,
            createdBy: userId,
          })
          .returning();

        let url: string;
        if (delivery === "bucket") {
          const fragment = recipient.password
            ? `w=${await wrapKeyWithPassword(shareKey, recipient.password)}`
            : `k=${shareKey.toString("base64url")}`;
          // The fragment is never transmitted, which is what keeps the store unable to read what
          // it is holding.
          url = `${pageUrl}#${fragment}`;
        } else {
          await this.doorman.putPolicy(tokenDirName(token), {
            shareId: share.id,
            filename,
            expiresAt: expiresAt.toISOString(),
            maxDownloads: link.maxDownloads,
            passwordHash,
            message: input.message ?? null,
            fileCount: files.length,
            sealedBytes,
          });
          url = this.linkUrl(token);
        }

        minted.push({ linkId: link.id, recipientLabel: recipient.label, url });
      }

      await this.audit.record({
        actorUserId: userId,
        action: "share.create",
        entityType: "share",
        entityId: share.id,
        metadata: { fileCount: files.length, recipients: input.recipients.length, delivery, expiresAt },
        ip,
      });

      return { id: share.id, links: minted };
    } finally {
      await rm(zipTemp, { force: true });
      await rm(sealedTemp, { force: true });
    }
  }

  async list() {
    const rows = await this.db
      .select({
        share: shares,
        createdBy: users.displayName,
        linkCount: sql<number>`count(distinct ${shareLinks.id})::int`,
        downloads: sql<number>`coalesce(sum(${shareLinks.downloadCount}), 0)::int`,
      })
      .from(shares)
      .leftJoin(shareLinks, eq(shareLinks.shareId, shares.id))
      .leftJoin(users, eq(users.id, shares.createdBy))
      .groupBy(shares.id, users.displayName)
      .orderBy(desc(shares.createdAt));

    return rows.map((r) => ({
      id: r.share.id,
      label: r.share.label,
      delivery: r.share.delivery,
      fileCount: r.share.fileCount,
      byteSize: r.share.byteSize,
      expiresAt: r.share.expiresAt,
      createdAt: r.share.createdAt,
      createdBy: r.createdBy,
      recipientCount: r.linkCount,
      downloadCount: r.downloads,
      status: shareStatus(r.share),
    }));
  }

  async get(id: string) {
    const [share] = await this.db.select().from(shares).where(eq(shares.id, id));
    if (!share) throw new NotFoundException("That share does not exist.");

    const links = await this.db.select().from(shareLinks).where(eq(shareLinks.shareId, id)).orderBy(shareLinks.createdAt);
    const contents = await this.db
      .select({
        documentId: shareFiles.documentId,
        filename: shareFiles.filenameInBundle,
        title: documents.title,
        deleted: documents.deletedAt,
      })
      .from(shareFiles)
      .leftJoin(documents, eq(documents.id, shareFiles.documentId))
      .where(eq(shareFiles.shareId, id))
      .orderBy(shareFiles.sortOrder);

    const events = links.length
      ? await this.db
          .select()
          .from(shareAccessLog)
          .where(
            inArray(
              shareAccessLog.shareLinkId,
              links.map((l) => l.id),
            ),
          )
          .orderBy(desc(shareAccessLog.createdAt))
          .limit(200)
      : [];

    return {
      id: share.id,
      label: share.label,
      message: share.message,
      delivery: share.delivery,
      fileCount: share.fileCount,
      byteSize: share.byteSize,
      expiresAt: share.expiresAt,
      createdAt: share.createdAt,
      purgedAt: share.purgedAt,
      status: shareStatus(share),
      files: contents,
      links: links.map((l) => ({
        id: l.id,
        recipientLabel: l.recipientLabel,
        hasPassword: Boolean(l.passwordHash),
        maxDownloads: l.maxDownloads,
        downloadCount: l.downloadCount,
        firstOpenedAt: l.firstOpenedAt,
        lastDownloadedAt: l.lastDownloadedAt,
        revokedAt: l.revokedAt,
      })),
      events: events.map((e) => ({
        id: e.id,
        shareLinkId: e.shareLinkId,
        event: e.event as ShareAccessEvent,
        reason: e.reason,
        ip: e.ip,
        userAgent: e.userAgent,
        createdAt: e.createdAt,
      })),
    };
  }

  /**
   * Revoking destroys the bundle and its key, at home, together. The rows and the audit trail
   * stay: "what did we send the Steuerberater in 2025" has to remain answerable long after the
   * link is dead.
   */
  async revoke(id: string, userId: string, ip: string | null) {
    const [share] = await this.db.select().from(shares).where(eq(shares.id, id));
    if (!share) throw new NotFoundException("That share does not exist.");
    if (share.revokedAt) return this.get(id);

    await this.purgeBundle(share.id);
    await this.db.update(shares).set({ revokedAt: new Date(), revokedBy: userId, purgedAt: new Date() }).where(eq(shares.id, id));
    await this.db.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.shareId, id));

    await this.audit.record({ actorUserId: userId, action: "share.revoke", entityType: "share", entityId: id, metadata: {}, ip });
    return this.get(id);
  }

  /**
   * Expiry is not cleanup — a bundle outliving its share is the whole exposure (§10.7). Run from
   * the scheduler; a failure is logged loudly rather than retried silently.
   */
  async purgeExpired(now = new Date()): Promise<number> {
    const due = await this.db
      .select({ id: shares.id })
      .from(shares)
      .where(and(isNull(shares.purgedAt), lte(shares.expiresAt, now)));

    let purged = 0;
    for (const { id } of due) {
      try {
        await this.purgeBundle(id);
        await this.db.update(shares).set({ purgedAt: new Date() }).where(eq(shares.id, id));
        purged++;
      } catch (err) {
        this.log.error(`Could not purge the bundle for share ${id}: ${(err as Error).message}`);
      }
    }
    if (purged) this.log.log(`Purged ${purged} expired share bundle${purged === 1 ? "" : "s"}`);
    return purged;
  }

  /** Bundle, key and every policy that points at it. */
  private async purgeBundle(shareId: string): Promise<void> {
    const [share] = await this.db.select({ delivery: shares.delivery, objectKey: shares.objectKey }).from(shares).where(eq(shares.id, shareId));
    const links = await this.db.select({ tokenHash: shareLinks.tokenHash }).from(shareLinks).where(eq(shareLinks.shareId, shareId));
    for (const l of links) {
      await this.doorman.deletePolicy(l.tokenHash);
      await this.doorman.deleteState(l.tokenHash);
    }
    await this.doorman.deleteBundle(shareId);
    // A `bucket` share is withdrawn by deleting the objects: the link stops resolving because the
    // bytes are gone. The key in the fragment never expires, so this is the only thing that ends it.
    if (share?.delivery === "bucket" && share.objectKey) await this.bucket.remove(share.objectKey);
  }

  private async filesFor(documentIds: string[]) {
    const rows = await this.db
      .select({
        documentId: documents.id,
        title: documents.title,
        id: documentFiles.id,
        storageKey: documentFiles.storageKey,
        dekWrapped: documentFiles.dekWrapped,
        iv: documentFiles.iv,
        authTag: documentFiles.authTag,
        byteSize: documentFiles.byteSize,
        originalFilename: documentFiles.originalFilename,
      })
      .from(documents)
      .innerJoin(documentFiles, and(eq(documentFiles.documentId, documents.id), eq(documentFiles.isCurrent, true)))
      .where(and(inArray(documents.id, documentIds), isNull(documents.deletedAt)));

    if (rows.length !== documentIds.length) {
      throw new BadRequestException("One of those documents is no longer in the vault. Refresh and try again.");
    }
    // Keep the order the basket was in, not the order Postgres returned.
    const byId = new Map(rows.map((r) => [r.documentId, r]));
    return documentIds.map((id) => byId.get(id)!);
  }

  /**
   * The public address of a link. Until `harbor public enable` exists this points at the doorman's
   * own origin from configuration; it is deliberately *not* derived from WEB_ORIGIN, because the
   * app and the doorman must never share one (§10.6).
   */
  private linkUrl(token: string): string {
    const base = this.config.get("SHARE_ORIGIN", { infer: true });
    return `${String(base).replace(/\/$/, "")}/s/${token}`;
  }
}

const pbkdf2 = promisify(pbkdf2Cb);

/**
 * Wrap a share key under a password, for a `bucket` link's fragment (§10.10).
 *
 * PBKDF2-SHA256 at 600,000 iterations, because the *unwrapping* happens in a browser and Web
 * Crypto offers no argon2 — shipping a WebAssembly argon2 to the one page that must have no
 * third-party code would be the worse trade. Matching parameters live in `landing-page.ts`, and
 * neither side can change them alone.
 *
 * Output is `salt.iv.wrapped`, base64url, small enough to live in a URL.
 */
export async function wrapKeyWithPassword(key: Buffer, password: string): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const derived = await pbkdf2(password, salt, 600_000, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", derived, iv);
  const wrapped = Buffer.concat([cipher.update(key), cipher.final(), cipher.getAuthTag()]);
  return [salt, iv, wrapped].map((b) => b.toString("base64url")).join(".");
}

/** A filename the recipient will read, from a label the owner wrote. */
function slugForFile(label: string): string {
  const cleaned = label
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "harbor-share";
}
