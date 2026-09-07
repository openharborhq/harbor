import { Injectable } from "@nestjs/common";
import { asc, sql } from "drizzle-orm";
import { documentPeople, documents, people, type Db } from "@trustworthier/db";
import type { CreatePerson, Person } from "@trustworthier/shared";
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
        documentCount: sql<number>`(select count(*)::int from ${documentPeople} dp join ${documents} d on d.id = dp.document_id where dp.person_id = "people"."id" and d.deleted_at is null)`, // qualified on purpose: drizzle renders ${people.id} as a bare "id" here, which the subquery resolves to the wrong table
      })
      .from(people)
      .orderBy(asc(people.sortOrder), asc(people.createdAt));
    return rows.map((r) => ({
      id: r.person.id,
      displayName: r.person.displayName,
      dateOfBirth: r.person.dateOfBirth,
      relationship: r.person.relationship,
      notes: r.person.notes,
      documentCount: r.documentCount,
    }));
  }

  async create(input: CreatePerson, actorUserId: string): Promise<Person> {
    const [created] = await this.db
      .insert(people)
      .values({
        displayName: input.displayName,
        dateOfBirth: input.dateOfBirth ?? null,
        relationship: input.relationship ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    await this.audit.record({ action: "person.create", actorUserId, entityType: "person", entityId: created!.id, metadata: { name: input.displayName } });
    return { ...created!, documentCount: 0 };
  }
}
