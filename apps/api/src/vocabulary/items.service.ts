import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { open, rm } from "node:fs/promises";
import type { Readable } from "node:stream";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { documentItems, documents, itemKeyDocuments, items, type Db } from "@harbor/db";
import {
  DEFAULT_KEY_DOCUMENTS,
  itemSubtitle,
  type CreateItem,
  type Item,
  type ItemKind,
  type KeyDocumentSlot,
  type UpdateItem,
  type UpsertKeyDocument,
} from "@harbor/shared";
import { AuditService } from "../audit/audit.service";
import { CryptoService } from "../crypto/crypto.service";
import { InjectDb } from "../db/db.module";
import { SearchIndexService } from "../search/search-index.service";
import { BlobStore } from "../storage/blob-store.service";
import { sniffImage } from "./image-type";

type Row = typeof items.$inferSelect;

/**
 * Items are the things documents are about — people, houses, cars, accounts (spec §6).
 * People are one kind among several, which is why there is no separate people service.
 */
@Injectable()
export class ItemsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly searchIndex: SearchIndexService,
    private readonly blobs: BlobStore,
    private readonly crypto: CryptoService,
  ) {}

  async list(kinds?: ItemKind[]): Promise<Item[]> {
    const rows = await this.db
      .select({
        item: items,
        // Qualified on purpose: drizzle renders ${items.id} as a bare "id" inside a subquery,
        // which Postgres then resolves against the joined table.
        documentCount: sql<number>`(select count(*)::int from ${documentItems} di join ${documents} d on d.id = di.document_id where di.item_id = "items"."id" and d.deleted_at is null)`,
      })
      .from(items)
      .where(kinds?.length ? inArray(items.kind, kinds) : sql`true`)
      .orderBy(asc(items.sortOrder), asc(items.createdAt));

    const labels = new Map(rows.map((r) => [r.item.id, r.item.label]));
    return rows.map((r) => toItem(r.item, r.documentCount, r.item.parentId ? (labels.get(r.item.parentId) ?? null) : null));
  }

  async get(itemId: string): Promise<Item> {
    const found = (await this.list()).find((i) => i.id === itemId);
    if (!found) throw new NotFoundException("Item not found");
    return found;
  }

  async create(input: CreateItem, actorUserId: string): Promise<Item> {
    if (input.parentId) await this.assertValidParent(null, input.parentId, input.kind);
    const [max] = await this.db.select({ n: sql<number>`coalesce(max(sort_order), -1)::int` }).from(items).where(eq(items.kind, input.kind));
    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(items)
        .values({
          kind: input.kind,
          label: input.label,
          details: input.details ?? {},
          parentId: input.parentId ?? null,
          notes: input.notes ?? null,
          sortOrder: (max?.n ?? -1) + 1,
        })
        .returning();
      const slots = DEFAULT_KEY_DOCUMENTS[input.kind] ?? [];
      if (slots.length) await tx.insert(itemKeyDocuments).values(slots.map((kind, i) => ({ itemId: row!.id, kind, sortOrder: i })));
      return row!;
    });
    await this.audit.record({ action: "item.create", actorUserId, entityType: "item", entityId: created.id, metadata: { kind: input.kind, label: input.label } });
    return toItem(created, 0, null);
  }

  async update(itemId: string, patch: UpdateItem, actorUserId: string): Promise<Item> {
    const current = await this.get(itemId);
    if (patch.parentId) await this.assertValidParent(itemId, patch.parentId, patch.kind ?? current.kind);
    const set: Partial<typeof items.$inferInsert> = {};
    if (patch.label !== undefined) set.label = patch.label;
    if (patch.kind !== undefined) set.kind = patch.kind;
    if (patch.details !== undefined) set.details = patch.details;
    if (patch.parentId !== undefined) set.parentId = patch.parentId;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (Object.keys(set).length) {
      await this.db.transaction(async (tx) => {
        await tx.update(items).set(set).where(eq(items.id, itemId));
        // Item labels are weight B in the search index, so a rename leaves every document about
        // this item still answering to the old name.
        if (patch.label !== undefined) {
          const rows = await tx.select({ id: documentItems.documentId }).from(documentItems).where(eq(documentItems.itemId, itemId));
          await this.searchIndex.reindex(rows.map((r) => r.id), tx);
        }
      });
    }
    await this.audit.record({ action: "item.update", actorUserId, entityType: "item", entityId: itemId, metadata: { fields: Object.keys(set) } });
    return this.get(itemId);
  }

  /**
   * Deletes the item itself and nothing else. Its documents are only unlinked — they keep their
   * category and their bytes — and any thing inside it moves up to the top level rather than
   * disappearing with its parent (FK `on delete set null`). There is no undo, so the UI states
   * both counts before asking. Item labels are weight B in the search index, so the affected
   * documents are reindexed or the deleted name would keep matching.
   */
  async remove(itemId: string, actorUserId: string): Promise<{ documentsUnlinked: number; childrenDetached: number }> {
    const item = await this.get(itemId);
    const [affected, children] = await Promise.all([
      this.db.select({ id: documentItems.documentId }).from(documentItems).where(eq(documentItems.itemId, itemId)),
      this.children(itemId),
    ]);
    const documentIds = affected.map((r) => r.id);
    await this.db.transaction(async (tx) => {
      await tx.delete(items).where(eq(items.id, itemId));
      // After the delete, so the label is gone from the vector we rebuild.
      await this.searchIndex.reindex(documentIds, tx);
    });
    await this.audit.record({
      action: "item.delete",
      actorUserId,
      entityType: "item",
      entityId: itemId,
      metadata: { kind: item.kind, label: item.label, documentsUnlinked: documentIds.length, childrenDetached: children.length },
    });
    return { documentsUnlinked: documentIds.length, childrenDetached: children.length };
  }

  // ---------- photographs (spec §6) ----------

  /**
   * Attach a photo. It arrives already cropped to a square by the browser, which is the point:
   * the vault never holds the picture you did not choose to show, only the face you framed.
   *
   * The temp file is removed either way — on the way in when it is refused, and after sealing
   * when it is kept — so a rejected upload leaves nothing on the disk.
   */
  async setAvatar(itemId: string, upload: { path: string; byteSize: number }, actorUserId: string): Promise<Item> {
    const item = await this.get(itemId);
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
      return this.get(itemId);
    } finally {
      await rm(upload.path, { force: true });
    }
  }

  async removeAvatar(itemId: string, actorUserId: string): Promise<Item> {
    const item = await this.get(itemId);
    const [row] = await this.db.select({ key: items.avatarStorageKey }).from(items).where(eq(items.id, itemId));
    if (!row?.key) return item;
    await this.db
      .update(items)
      .set({ avatarStorageKey: null, avatarDekWrapped: null, avatarIv: null, avatarTag: null, avatarMime: null, avatarUpdatedAt: null })
      .where(eq(items.id, itemId));
    await this.blobs.delete(row.key);
    await this.audit.record({ action: "item.avatar_remove", actorUserId, entityType: "item", entityId: itemId, metadata: { label: item.label } });
    return this.get(itemId);
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

  /**
   * Nesting means "is a part of" — a boiler in a house, an engine in a boat (spec §6). Three ways
   * that can go wrong, all of them reachable from the API even though the forms avoid them:
   * a person is never a component of anything, nothing contains itself, and a chain that loops
   * back on itself would make both items unreachable from the top level.
   */
  private async assertValidParent(itemId: string | null, parentId: string, kind: ItemKind): Promise<void> {
    if (kind === "person") throw new BadRequestException("People aren't kept inside anything — they stand on their own.");
    if (itemId && parentId === itemId) throw new BadRequestException("An item can't be inside itself.");
    const all = await this.list();
    const parent = all.find((i) => i.id === parentId);
    if (!parent) throw new NotFoundException("Unknown parent item");
    if (!itemId) return;
    // Walk up from the proposed parent: meeting itemId means we'd be closing a loop.
    const byId = new Map(all.map((i) => [i.id, i]));
    const seen = new Set<string>();
    for (let node = parent; node && !seen.has(node.id); node = byId.get(node.parentId ?? "")!) {
      if (node.id === itemId) throw new BadRequestException(`${parent.label} is already inside this one, so it can't also contain it.`);
      seen.add(node.id);
      if (!node.parentId) break;
    }
  }

  /** Items whose parent is this one — the boiler inside the house (spec §6). */
  async children(itemId: string): Promise<Item[]> {
    return (await this.list()).filter((i) => i.parentId === itemId);
  }

  async keyDocuments(itemId: string): Promise<KeyDocumentSlot[]> {
    const rows = await this.db
      .select({ slot: itemKeyDocuments, doc: documents })
      .from(itemKeyDocuments)
      .leftJoin(documents, and(eq(documents.id, itemKeyDocuments.documentId), isNull(documents.deletedAt)))
      .where(eq(itemKeyDocuments.itemId, itemId))
      .orderBy(asc(itemKeyDocuments.sortOrder), asc(itemKeyDocuments.createdAt));
    return rows.map(({ slot, doc }) => ({
      id: slot.id,
      kind: slot.kind,
      sortOrder: slot.sortOrder,
      document: doc ? { id: doc.id, title: doc.title, expiresAt: doc.expiresAt, documentDate: doc.documentDate } : null,
    }));
  }

  async upsertKeyDocument(itemId: string, slotId: string | null, input: UpsertKeyDocument, actorUserId: string): Promise<KeyDocumentSlot[]> {
    await this.get(itemId);
    if (input.documentId) {
      const doc = await this.db.query.documents.findFirst({ where: and(eq(documents.id, input.documentId), isNull(documents.deletedAt)) });
      if (!doc) throw new NotFoundException("Document not found");
    }
    if (slotId) {
      await this.db
        .update(itemKeyDocuments)
        .set({ kind: input.kind, documentId: input.documentId ?? null })
        .where(and(eq(itemKeyDocuments.id, slotId), eq(itemKeyDocuments.itemId, itemId)));
    } else {
      const [max] = await this.db.select({ n: sql<number>`coalesce(max(sort_order), -1)::int` }).from(itemKeyDocuments).where(eq(itemKeyDocuments.itemId, itemId));
      await this.db.insert(itemKeyDocuments).values({ itemId, kind: input.kind, documentId: input.documentId ?? null, sortOrder: (max?.n ?? -1) + 1 });
    }
    await this.audit.record({ action: "item.key_document", actorUserId, entityType: "item", entityId: itemId, metadata: { kind: input.kind, documentId: input.documentId ?? null } });
    return this.keyDocuments(itemId);
  }

  async removeKeyDocument(itemId: string, slotId: string, actorUserId: string): Promise<KeyDocumentSlot[]> {
    await this.db.delete(itemKeyDocuments).where(and(eq(itemKeyDocuments.id, slotId), eq(itemKeyDocuments.itemId, itemId)));
    await this.audit.record({ action: "item.key_document_remove", actorUserId, entityType: "item", entityId: itemId, metadata: { slotId } });
    return this.keyDocuments(itemId);
  }
}

function toItem(row: Row, documentCount: number, parentLabel: string | null): Item {
  return {
    id: row.id,
    kind: row.kind as ItemKind,
    label: row.label,
    details: row.details,
    parentId: row.parentId,
    parentLabel,
    notes: row.notes,
    sortOrder: row.sortOrder,
    documentCount,
    avatarUpdatedAt: row.avatarUpdatedAt?.toISOString() ?? null,
  };
}

export { itemSubtitle };
