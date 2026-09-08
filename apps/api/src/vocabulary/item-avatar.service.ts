import { BadRequestException, Injectable } from "@nestjs/common";
import { open, rm } from "node:fs/promises";
import type { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { items, type Db } from "@harbor/db";
import type { Item } from "@harbor/shared";
import { AuditService } from "../audit/audit.service";
import { CryptoService } from "../crypto/crypto.service";
import { InjectDb } from "../db/db.module";
import { BlobStore } from "../storage/blob-store.service";
import { sniffImage } from "./image-type";
import { ItemsService } from "./items.service";

/**
 * Photographs of people and things (spec §6).
 *
 * Deliberately not part of ItemsService. Six processes share that service, and only the API has a
 * data volume mounted or any use for an upload — giving it a dependency on blob storage broke the
 * suggester in v0.5.0, which has no /data at all. What every process needs stays in ItemsService;
 * what only the web request path needs lives here, alongside the controller that calls it.
 */
@Injectable()
export class ItemAvatarService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly items: ItemsService,
    private readonly audit: AuditService,
    private readonly blobs: BlobStore,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Attach a photo. It arrives already cropped to a square by the browser, which is the point:
   * the vault never holds the picture you did not choose to show, only the face you framed.
   *
   * The temp file is removed either way — on the way in when it is refused, and after sealing
   * when it is kept — so a rejected upload leaves nothing on the disk.
   */
  async setAvatar(itemId: string, upload: { path: string; byteSize: number }, actorUserId: string): Promise<Item> {
    const item = await this.items.get(itemId);
    try {
      const mime = await this.sniff(upload.path);
      if (!mime) throw new BadRequestException("That is not a JPEG, PNG or WebP image.");

      const previous = await this.db.select({ key: items.avatarStorageKey }).from(items).where(eq(items.id, itemId));
      const dek = this.crypto.generateDek();
      const sealed = await this.blobs.sealFile(upload.path, dek);
      await this.db
        .update(items)
        .set({
          avatarStorageKey: sealed.storageKey,
          avatarDekWrapped: this.blobs.wrapDek(dek, sealed.storageKey),
          avatarIv: sealed.iv,
          avatarTag: sealed.authTag,
          avatarMime: mime,
          avatarUpdatedAt: new Date(),
        })
        .where(eq(items.id, itemId));

      // Only once the row points at the new blob: a crash in between costs an orphan, not a photo.
      const old = previous[0]?.key;
      if (old) await this.blobs.delete(old);

      await this.audit.record({
        action: "item.avatar_set",
        actorUserId,
        entityType: "item",
        entityId: itemId,
        metadata: { kind: item.kind, label: item.label, mimeType: mime, byteSize: sealed.byteSize },
      });
      return this.items.get(itemId);
    } finally {
      await rm(upload.path, { force: true });
    }
  }

  async removeAvatar(itemId: string, actorUserId: string): Promise<Item> {
    const item = await this.items.get(itemId);
    const [row] = await this.db.select({ key: items.avatarStorageKey }).from(items).where(eq(items.id, itemId));
    if (!row?.key) return item;
    await this.db
      .update(items)
      .set({ avatarStorageKey: null, avatarDekWrapped: null, avatarIv: null, avatarTag: null, avatarMime: null, avatarUpdatedAt: null })
      .where(eq(items.id, itemId));
    await this.blobs.delete(row.key);
    await this.audit.record({ action: "item.avatar_remove", actorUserId, entityType: "item", entityId: itemId, metadata: { label: item.label } });
    return this.items.get(itemId);
  }

  /** The decrypted photo, or null when the item has none. */
  async openAvatar(itemId: string): Promise<{ stream: Readable; mimeType: string; version: string } | null> {
    const [row] = await this.db
      .select({
        key: items.avatarStorageKey,
        dek: items.avatarDekWrapped,
        iv: items.avatarIv,
        tag: items.avatarTag,
        mime: items.avatarMime,
        at: items.avatarUpdatedAt,
      })
      .from(items)
      .where(eq(items.id, itemId));
    if (!row?.key || !row.dek || !row.iv || !row.tag) return null;
    return {
      stream: this.blobs.openStream(row.key, this.blobs.unwrapDek(row.dek, row.key), row.iv, row.tag),
      mimeType: row.mime ?? "application/octet-stream",
      version: String(row.at?.getTime() ?? 0),
    };
  }

  /** The first bytes only: enough to know the format, without reading the file into memory. */
  private async sniff(file: string): Promise<string | null> {
    const fh = await open(file, "r");
    try {
      const head = Buffer.alloc(12);
      const { bytesRead } = await fh.read(head, 0, 12, 0);
      return sniffImage(head.subarray(0, bytesRead));
    } finally {
      await fh.close();
    }
  }

}
