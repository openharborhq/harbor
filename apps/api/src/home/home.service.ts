import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { documentPeople, documents, people, type Db } from "@trustworthier/db";
import type { HomeData } from "@trustworthier/shared";
import { InjectDb } from "../db/db.module";
import { CategoriesService } from "../vocabulary/categories.service";
import { PeopleService } from "../vocabulary/people.service";

const HORIZON_DAYS = 90;
const RECENT_LIMIT = 8;
const EXPIRING_LIMIT = 12;

@Injectable()
export class HomeService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly categoriesService: CategoriesService,
    private readonly peopleService: PeopleService,
  ) {}

  async load(): Promise<HomeData> {
    const today = isoToday();
    const horizon = addDays(today, HORIZON_DAYS);
    const [family, categories, cats, expiring, recent, totalRow] = await Promise.all([
      this.peopleService.list(),
      this.categoriesService.list(),
      this.categoriesService.index(),
      this.db
        .select({ id: documents.id, title: documents.title, categoryId: documents.categoryId, expiresAt: documents.expiresAt })
        .from(documents)
        .where(and(isNull(documents.deletedAt), gte(documents.expiresAt, today), lte(documents.expiresAt, horizon)))
        .orderBy(asc(documents.expiresAt))
        .limit(EXPIRING_LIMIT),
      this.db
        .select({ id: documents.id, title: documents.title, source: documents.source, categoryId: documents.categoryId, createdAt: documents.createdAt })
        .from(documents)
        .where(isNull(documents.deletedAt))
        .orderBy(desc(documents.createdAt))
        .limit(RECENT_LIMIT),
      this.db.select({ n: sql<number>`count(*)::int` }).from(documents).where(isNull(documents.deletedAt)),
    ]);

    // People on the expiring documents, and each person's soonest future expiry — two small queries.
    const expiringIds = expiring.map((d) => d.id);
    const links = expiringIds.length
      ? await this.db
          .select({ documentId: documentPeople.documentId, name: people.displayName })
          .from(documentPeople)
          .innerJoin(people, eq(people.id, documentPeople.personId))
          .where(inArray(documentPeople.documentId, expiringIds))
      : [];
    const nextPerPerson = await this.db
      .select({ personId: documentPeople.personId, documentId: documents.id, title: documents.title, expiresAt: documents.expiresAt })
      .from(documentPeople)
      .innerJoin(documents, eq(documents.id, documentPeople.documentId))
      .where(and(isNull(documents.deletedAt), gte(documents.expiresAt, today)))
      .orderBy(asc(documents.expiresAt));
    const soonest = new Map<string, (typeof nextPerPerson)[number]>();
    for (const r of nextPerPerson) if (!soonest.has(r.personId)) soonest.set(r.personId, r);

    const pathOf = (categoryId: string | null) => (categoryId ? (cats.get(categoryId)?.path ?? null) : null);

    return {
      family: family.map((p) => {
        const n = soonest.get(p.id);
        return {
          id: p.id,
          displayName: p.displayName,
          relationship: p.relationship,
          documentCount: p.documentCount,
          next: n && n.expiresAt ? { documentId: n.documentId, title: n.title, expiresAt: n.expiresAt, daysLeft: daysBetween(today, n.expiresAt) } : null,
        };
      }),
      categories,
      totalDocuments: totalRow[0]?.n ?? 0,
      expiringSoon: expiring.map((d) => ({
        documentId: d.id,
        title: d.title,
        categoryPath: pathOf(d.categoryId),
        people: links.filter((l) => l.documentId === d.id).map((l) => l.name),
        expiresAt: d.expiresAt!,
        daysLeft: daysBetween(today, d.expiresAt!),
      })),
      recentlyAdded: recent.map((d) => ({
        documentId: d.id,
        title: d.title,
        source: d.source,
        categoryPath: pathOf(d.categoryId),
        createdAt: d.createdAt.toISOString(),
        needsFiling: d.categoryId === null,
      })),
    };
  }
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}
