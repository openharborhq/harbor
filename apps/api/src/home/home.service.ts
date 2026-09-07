import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { documentItems, documents, items, type Db } from "@harbor/db";
import { itemSubtitle, type HomeData, type Item } from "@harbor/shared";
import { InjectDb } from "../db/db.module";
import { CategoriesService } from "../vocabulary/categories.service";
import { ItemsService } from "../vocabulary/items.service";

const HORIZON_DAYS = 90;
const RECENT_LIMIT = 8;
const EXPIRING_LIMIT = 12;

@Injectable()
export class HomeService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly categoriesService: CategoriesService,
    private readonly itemsService: ItemsService,
  ) {}

  async load(): Promise<HomeData> {
    const today = isoToday();
    const horizon = addDays(today, HORIZON_DAYS);
    const [allItems, categories, cats, expiring, recent, totalRow] = await Promise.all([
      this.itemsService.list(),
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

    // Items on the expiring documents, and each item's soonest future expiry — two small queries.
    const expiringIds = expiring.map((d) => d.id);
    const links = expiringIds.length
      ? await this.db
          .select({ documentId: documentItems.documentId, label: items.label })
          .from(documentItems)
          .innerJoin(items, eq(items.id, documentItems.itemId))
          .where(inArray(documentItems.documentId, expiringIds))
      : [];
    const nextPerItem = await this.db
      .select({ itemId: documentItems.itemId, documentId: documents.id, title: documents.title, expiresAt: documents.expiresAt })
      .from(documentItems)
      .innerJoin(documents, eq(documents.id, documentItems.documentId))
      .where(and(isNull(documents.deletedAt), gte(documents.expiresAt, today)))
      .orderBy(asc(documents.expiresAt));
    const soonest = new Map<string, (typeof nextPerItem)[number]>();
    for (const r of nextPerItem) if (!soonest.has(r.itemId)) soonest.set(r.itemId, r);

    const pathOf = (categoryId: string | null) => (categoryId ? (cats.get(categoryId)?.path ?? null) : null);
    const toHomeItem = (i: Item) => {
      const n = soonest.get(i.id);
      return {
        id: i.id,
        kind: i.kind,
        label: i.label,
        subtitle: itemSubtitle(i) ?? i.parentLabel,
        documentCount: i.documentCount,
        next: n && n.expiresAt ? { documentId: n.documentId, title: n.title, expiresAt: n.expiresAt, daysLeft: daysBetween(today, n.expiresAt) } : null,
      };
    };

    return {
      family: allItems.filter((i) => i.kind === "person").map(toHomeItem),
      // Top-level things only; a boiler shows on its property's page, not on Home.
      things: allItems.filter((i) => i.kind !== "person" && i.parentId === null).map(toHomeItem),
      categories,
      totalDocuments: totalRow[0]?.n ?? 0,
      expiringSoon: expiring.map((d) => ({
        documentId: d.id,
        title: d.title,
        categoryPath: pathOf(d.categoryId),
        items: links.filter((l) => l.documentId === d.id).map((l) => l.label),
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
