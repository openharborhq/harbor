import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { categories, documents, tags, type Db } from "@trustworthier/db";
import { categoryPath, slugify, type Category, type CreateCategory } from "@trustworthier/shared";
import { AuditService } from "../audit/audit.service";
import { InjectDb } from "../db/db.module";

/**
 * The design's default vocabulary (Home artboard). A child may pin an explicit `slug` so its
 * display name can change in a later release without splitting into a second category —
 * the slug is the identity that suggestions and existing filings refer to.
 */
type DefaultChild = string | { name: string; slug: string };
export const DEFAULT_CATEGORIES: { name: string; icon: string; children: DefaultChild[] }[] = [
  { name: "Identity", icon: "id", children: ["Passports", "Birth", "Licenses", "Social Security"] },
  { name: "Real Estate", icon: "home", children: ["Deeds", "Mortgage", "Permits", "Utilities", "Warranties", "Lease"] },
  { name: "Transportation", icon: "car", children: ["Cars", "Boat", "ATV", "Trailer & RV"] },
  { name: "Money", icon: "money", children: ["Banking", "Statements", "Investments", "Retirement"] },
  // Things you own: the receipt, the warranty and the manual for the washing machine belong together.
  // Deliberately a purpose, not a format — a general "Receipts" category would cut across every other one.
  { name: "Purchases", icon: "purchase", children: ["Receipts", "Warranties", "Manuals"] },
  // Renamed from "Receipts" once Purchases existed; the slug stays so nothing is re-filed.
  { name: "Taxes", icon: "tax", children: ["Returns", "W-2 & 1099", { name: "Deductible Receipts", slug: "receipts" }] },
  { name: "Insurance", icon: "shield", children: ["Auto", "Home", "Life", "Health"] },
  { name: "Health", icon: "health", children: ["Records", "Prescriptions", "Immunizations"] },
  { name: "Legal & Estate", icon: "legal", children: ["Wills & Trusts", "POA", "Beneficiaries"] },
  { name: "Work", icon: "work", children: ["Contracts", "Pay & Benefits"] },
  { name: "Education", icon: "education", children: ["Report Cards", "Transcripts", "Savings Plans"] },
  { name: "Travel", icon: "travel", children: ["Trips", "Visas & Global Entry"] },
];

/**
 * Cross-cutting attributes of a document's *form*, which is what tags are for. Kept short: the
 * model may only choose from this list, and a long list makes the choice noisy.
 */
export const DEFAULT_TAGS = ["receipt", "warranty", "manual", "contract", "certificate", "policy", "correspondence"];

@Injectable()
export class CategoriesService {
  private readonly log = new Logger(CategoriesService.name);
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * Idempotent top-up: creates any default category or tag whose slug is missing, so an existing
   * vault picks up additions on upgrade. Never renames or deletes what the household already has.
   */
  async ensureDefaults(): Promise<void> {
    const existing = new Map((await this.db.select({ id: categories.id, slug: categories.slug }).from(categories)).map((c) => [c.slug, c.id]));
    let added = 0;
    for (const [order, top] of DEFAULT_CATEGORIES.entries()) {
      const topSlug = slugify(top.name);
      let parentId = existing.get(topSlug);
      if (!parentId) {
        const [row] = await this.db.insert(categories).values({ name: top.name, slug: topSlug, icon: top.icon, sortOrder: order }).returning({ id: categories.id });
        parentId = row!.id;
        existing.set(topSlug, parentId);
        added++;
      }
      for (const [childOrder, child] of top.children.entries()) {
        const name = typeof child === "string" ? child : child.name;
        const slug = `${topSlug}/${typeof child === "string" ? slugify(name) : child.slug}`;
        if (existing.has(slug)) continue;
        await this.db.insert(categories).values({ name, slug, parentId, sortOrder: childOrder });
        existing.set(slug, "");
        added++;
      }
    }

    const haveTags = new Set((await this.db.select({ slug: tags.slug }).from(tags)).map((t) => t.slug));
    const newTags = DEFAULT_TAGS.filter((t) => !haveTags.has(slugify(t)));
    if (newTags.length) await this.db.insert(tags).values(newTags.map((name) => ({ name, slug: slugify(name) })));

    if (added || newTags.length) this.log.log(`vocabulary top-up: +${added} categories, +${newTags.length} tags`);
  }

  async rename(categoryId: string, name: string, actorUserId: string): Promise<Category> {
    const cat = await this.db.query.categories.findFirst({ where: eq(categories.id, categoryId) });
    if (!cat) throw new NotFoundException("Category not found");
    const parent = cat.parentId ? await this.db.query.categories.findFirst({ where: eq(categories.id, cat.parentId) }) : null;
    const slug = parent ? `${parent.slug}/${slugify(name)}` : slugify(name);
    await this.db.update(categories).set({ name, slug }).where(eq(categories.id, categoryId));
    await this.audit.record({ action: "category.rename", actorUserId, entityType: "category", entityId: categoryId, metadata: { from: cat.name, to: name } });
    return (await this.list()).find((c) => c.id === categoryId)!;
  }

  async list(): Promise<Category[]> {
    const rows = await this.db
      .select({
        cat: categories,
        documentCount: sql<number>`(select count(*)::int from ${documents} d where d.category_id = "categories"."id" and d.deleted_at is null)`, // qualified on purpose: see ItemsService.list
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
