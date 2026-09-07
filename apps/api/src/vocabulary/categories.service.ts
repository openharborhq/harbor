import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { categories, documents, type Db } from "@trustworthier/db";
import { categoryPath, slugify, type Category, type CreateCategory } from "@trustworthier/shared";
import { AuditService } from "../audit/audit.service";
import { InjectDb } from "../db/db.module";

/** The design's default vocabulary (Home artboard). Seeded once when the table is empty. */
export const DEFAULT_CATEGORIES: { name: string; icon: string; children: string[] }[] = [
  { name: "Identity", icon: "id", children: ["Passports", "Birth", "Licenses", "Social Security"] },
  { name: "Real Estate", icon: "home", children: ["Deeds", "Mortgage", "Permits", "Utilities", "Warranties", "Lease"] },
  { name: "Transportation", icon: "car", children: ["Cars", "Boat", "ATV", "Trailer & RV"] },
  { name: "Money", icon: "money", children: ["Banking", "Statements", "Investments", "Retirement"] },
  { name: "Taxes", icon: "tax", children: ["Returns", "W-2 & 1099", "Receipts"] },
  { name: "Insurance", icon: "shield", children: ["Auto", "Home", "Life", "Health"] },
  { name: "Health", icon: "health", children: ["Records", "Prescriptions", "Immunizations"] },
  { name: "Legal & Estate", icon: "legal", children: ["Wills & Trusts", "POA", "Beneficiaries"] },
  { name: "Work", icon: "work", children: ["Contracts", "Pay & Benefits"] },
  { name: "Education", icon: "education", children: ["Report Cards", "Transcripts", "Savings Plans"] },
  { name: "Travel", icon: "travel", children: ["Trips", "Visas & Global Entry"] },
];

@Injectable()
export class CategoriesService {
  private readonly log = new Logger(CategoriesService.name);
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Idempotent: only runs when there are no categories at all. */
  async ensureDefaults(): Promise<void> {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(categories);
    if ((row?.n ?? 0) > 0) return;
    await this.db.transaction(async (tx) => {
      let order = 0;
      for (const top of DEFAULT_CATEGORIES) {
        const [parent] = await tx
          .insert(categories)
          .values({ name: top.name, slug: slugify(top.name), icon: top.icon, sortOrder: order++ })
          .returning({ id: categories.id });
        let childOrder = 0;
        for (const name of top.children) {
          await tx.insert(categories).values({
            name,
            slug: `${slugify(top.name)}/${slugify(name)}`,
            parentId: parent!.id,
            sortOrder: childOrder++,
          });
        }
      }
    });
    this.log.log(`seeded ${DEFAULT_CATEGORIES.length} default categories`);
  }

  async list(): Promise<Category[]> {
    const rows = await this.db
      .select({
        cat: categories,
        documentCount: sql<number>`(select count(*)::int from ${documents} d where d.category_id = "categories"."id" and d.deleted_at is null)`, // qualified on purpose: see PeopleService.list
      })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    return rows.map((r) => ({ ...r.cat, documentCount: r.documentCount }));
  }

  /** id -> {category, parent} for path rendering; one query per request. */
  async index(): Promise<Map<string, { cat: typeof categories.$inferSelect; path: string }>> {
    const all = await this.db.select().from(categories);
    const byId = new Map(all.map((c) => [c.id, c]));
    return new Map(all.map((c) => [c.id, { cat: c, path: categoryPath(c, c.parentId ? byId.get(c.parentId) : null) }]));
  }

  async create(input: CreateCategory, actorUserId: string): Promise<Category> {
    let slug = slugify(input.name);
    if (input.parentId) {
      const parent = await this.db.query.categories.findFirst({ where: eq(categories.id, input.parentId) });
      if (!parent) throw new NotFoundException("Parent category not found");
      if (parent.parentId) throw new BadRequestException("Categories can only be two levels deep");
      slug = `${parent.slug}/${slug}`;
    }
    const [maxOrder] = await this.db
      .select({ n: sql<number>`coalesce(max(sort_order), -1)::int` })
      .from(categories)
      .where(input.parentId ? eq(categories.parentId, input.parentId) : isNull(categories.parentId));
    const [created] = await this.db
      .insert(categories)
      .values({ name: input.name, slug, parentId: input.parentId ?? null, icon: input.icon ?? null, sortOrder: (maxOrder?.n ?? -1) + 1 })
      .returning();
    await this.audit.record({ action: "category.create", actorUserId, entityType: "category", entityId: created!.id, metadata: { name: input.name } });
    return { ...created!, documentCount: 0 };
  }
}
