import { Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { documentPeople, documents, people, personKeyDocuments, type Db } from "@trustworthier/db";
import { DEFAULT_KEY_DOCUMENT_KINDS, type CreatePerson, type KeyDocumentSlot, type Person, type UpdatePerson, type UpsertKeyDocument } from "@trustworthier/shared";
import { AuditService } from "../audit/audit.service";
import { InjectDb } from "../db/db.module";

@Injectable()
export class PeopleService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Person[]> {
    const rows = await this.db
      .select({
        person: people,
        // Qualified on purpose: drizzle renders ${people.id} as a bare "id" here, which the subquery resolves to the wrong table.
        documentCount: sql<number>`(select count(*)::int from ${documentPeople} dp join ${documents} d on d.id = dp.document_id where dp.person_id = "people"."id" and d.deleted_at is null)`,
      })
      .from(people)
      .orderBy(asc(people.sortOrder), asc(people.createdAt));
    return rows.map((r) => toPerson(r.person, r.documentCount));
  }

  async get(personId: string): Promise<Person> {
    const p = (await this.list()).find((x) => x.id === personId);
    if (!p) throw new NotFoundException("Person not found");
    return p;
  }

  async create(input: CreatePerson, actorUserId: string): Promise<Person> {
    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(people)
        .values({ displayName: input.displayName, dateOfBirth: input.dateOfBirth ?? null, relationship: input.relationship ?? null, notes: input.notes ?? null })
        .returning();
      await tx.insert(personKeyDocuments).values(DEFAULT_KEY_DOCUMENT_KINDS.map((kind, i) => ({ personId: row!.id, kind, sortOrder: i })));
      return row!;
    });
    await this.audit.record({ action: "person.create", actorUserId, entityType: "person", entityId: created.id, metadata: { name: input.displayName } });
    return toPerson(created, 0);
  }

  async update(personId: string, patch: UpdatePerson, actorUserId: string): Promise<Person> {
    await this.get(personId);
    const set: Partial<typeof people.$inferInsert> = {};
    if (patch.displayName !== undefined) set.displayName = patch.displayName;
    if (patch.dateOfBirth !== undefined) set.dateOfBirth = patch.dateOfBirth;
    if (patch.relationship !== undefined) set.relationship = patch.relationship;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (Object.keys(set).length) await this.db.update(people).set(set).where(eq(people.id, personId));
    await this.audit.record({ action: "person.update", actorUserId, entityType: "person", entityId: personId, metadata: { fields: Object.keys(set) } });
    return this.get(personId);
  }

  async keyDocuments(personId: string): Promise<KeyDocumentSlot[]> {
    const rows = await this.db
      .select({ slot: personKeyDocuments, doc: documents })
      .from(personKeyDocuments)
      .leftJoin(documents, and(eq(documents.id, personKeyDocuments.documentId), isNull(documents.deletedAt)))
      .where(eq(personKeyDocuments.personId, personId))
      .orderBy(asc(personKeyDocuments.sortOrder), asc(personKeyDocuments.createdAt));
    return rows.map(({ slot, doc }) => ({
      id: slot.id,
      kind: slot.kind,
      sortOrder: slot.sortOrder,
      document: doc ? { id: doc.id, title: doc.title, expiresAt: doc.expiresAt, documentDate: doc.documentDate } : null,
    }));
  }

  /** Add a slot, or (re)link an existing slot by id. */
  async upsertKeyDocument(personId: string, slotId: string | null, input: UpsertKeyDocument, actorUserId: string): Promise<KeyDocumentSlot[]> {
    await this.get(personId);
    if (input.documentId) {
      const doc = await this.db.query.documents.findFirst({ where: and(eq(documents.id, input.documentId), isNull(documents.deletedAt)) });
      if (!doc) throw new NotFoundException("Document not found");
    }
    if (slotId) {
      await this.db
        .update(personKeyDocuments)
        .set({ kind: input.kind, documentId: input.documentId ?? null })
        .where(and(eq(personKeyDocuments.id, slotId), eq(personKeyDocuments.personId, personId)));
    } else {
      const [max] = await this.db.select({ n: sql<number>`coalesce(max(sort_order), -1)::int` }).from(personKeyDocuments).where(eq(personKeyDocuments.personId, personId));
      await this.db.insert(personKeyDocuments).values({ personId, kind: input.kind, documentId: input.documentId ?? null, sortOrder: (max?.n ?? -1) + 1 });
    }
    await this.audit.record({ action: "person.key_document", actorUserId, entityType: "person", entityId: personId, metadata: { kind: input.kind, documentId: input.documentId ?? null } });
    return this.keyDocuments(personId);
  }

  async removeKeyDocument(personId: string, slotId: string, actorUserId: string): Promise<KeyDocumentSlot[]> {
    await this.db.delete(personKeyDocuments).where(and(eq(personKeyDocuments.id, slotId), eq(personKeyDocuments.personId, personId)));
    await this.audit.record({ action: "person.key_document_remove", actorUserId, entityType: "person", entityId: personId, metadata: { slotId } });
    return this.keyDocuments(personId);
  }
}

function toPerson(p: typeof people.$inferSelect, documentCount: number): Person {
  return { id: p.id, displayName: p.displayName, dateOfBirth: p.dateOfBirth, relationship: p.relationship, notes: p.notes, documentCount };
}
