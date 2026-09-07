import { Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { documentItems, documents, itemKeyDocuments, items, type Db } from "@trustworthier/db";
import {
  DEFAULT_KEY_DOCUMENTS,
  itemSubtitle,
  type CreateItem,
  type Item,
  type ItemKind,
  type KeyDocumentSlot,
  type UpdateItem,
  type UpsertKeyDocument,
} from "@trustworthier/shared";
import { AuditService } from "../audit/audit.service";
import { InjectDb } from "../db/db.module";

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
    await this.get(itemId);
    const set: Partial<typeof items.$inferInsert> = {};
    if (patch.label !== undefined) set.label = patch.label;
    if (patch.kind !== undefined) set.kind = patch.kind;
    if (patch.details !== undefined) set.details = patch.details;
    if (patch.parentId !== undefined) set.parentId = patch.parentId;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (Object.keys(set).length) await this.db.update(items).set(set).where(eq(items.id, itemId));
    await this.audit.record({ action: "item.update", actorUserId, entityType: "item", entityId: itemId, metadata: { fields: Object.keys(set) } });
    return this.get(itemId);
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
  };
}

export { itemSubtitle };
