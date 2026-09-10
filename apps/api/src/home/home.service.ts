import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { documentItems, documents, items, type Db } from "@harbor/db";
import { itemSubtitle, todayIso, type HomeData, type Item } from "@harbor/shared";
import { BackupsService } from "../backups/backups.service";
import { InjectDb } from "../db/db.module";
import { CategoriesService } from "../vocabulary/categories.service";
import { TasksService } from "../tasks/tasks.service";
import { ItemsService } from "../vocabulary/items.service";

const HORIZON_DAYS = 90;
const RECENT_LIMIT = 8;
const EXPIRING_LIMIT = 12;
const ATTENTION_LIMIT = 12;

@Injectable()
export class HomeService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly categoriesService: CategoriesService,
    private readonly itemsService: ItemsService,
    private readonly backups: BackupsService,
    private readonly tasks: TasksService,
  ) {}

  async load(): Promise<HomeData> {
    const today = todayIso();
    const horizon = addDays(today, HORIZON_DAYS);
    const [allItems, categories, cats, expiring, recent, totalRow, backupStatus, openTasks] = await Promise.all([
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
      this.backups.status(),
      this.tasks.list({ status: "open", limit: 200 }),
    ]);
    // Spec §4: Home says whether the vault is backed up. Only the last *completed* backup counts.
    const lastBackup = backupStatus.lastBackup?.status === "running" ? null : backupStatus.lastBackup;
    const backup: HomeData["backup"] = !backupStatus.configured
      ? { state: "unconfigured", at: null }
      : !lastBackup
        ? { state: "never", at: null }
        : { state: lastBackup.status === "ok" ? "ok" : "failed", at: lastBackup.finishedAt ?? lastBackup.startedAt };

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
        avatarUpdatedAt: i.avatarUpdatedAt,
        next: n && n.expiresAt ? { documentId: n.documentId, title: n.title, expiresAt: n.expiresAt, daysLeft: daysBetween(today, n.expiresAt) } : null,
      };
    };

    return {
      family: allItems.filter((i) => i.kind === "person").map(toHomeItem),
      // Top-level things only; a boiler shows on its property's page, not on Home.
      things: allItems.filter((i) => i.kind !== "person" && i.parentId === null).map(toHomeItem),
      categories,
      totalDocuments: totalRow[0]?.n ?? 0,
      backup,
      // Tasks first, then expiries, each soonest-first — a bill that lapsed last week outranks a
      // passport with six weeks left, and both outrank a task with no date at all.
      needsAttention: [
        ...openTasks.map((t) => ({
          kind: "task" as const,
          id: t.id,
          title: t.title,
          documentId: t.document?.id ?? null,
          subtitle: t.item?.label ?? t.document?.title ?? null,
          dueOn: t.dueOn,
          daysLeft: t.dueOn ? daysBetween(today, t.dueOn) : null,
          amountCents: t.amountCents,
          currency: t.currency,
        })),
        ...expiring.map((d) => ({
          kind: "expiry" as const,
          id: d.id,
          title: d.title,
          documentId: d.id,
          subtitle: links.filter((l) => l.documentId === d.id).map((l) => l.label).join(", ") || pathOf(d.categoryId),
          dueOn: d.expiresAt!,
          daysLeft: daysBetween(today, d.expiresAt!),
          amountCents: null,
          currency: null,
        })),
      ]
        .sort((a, b) => rank(a) - rank(b))
        .slice(0, ATTENTION_LIMIT),
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

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/**
 * Ordering for the one panel that holds both. Undated tasks sort last rather than first, which is
 * what a null would otherwise do; a task and an expiry on the same day sort task-first, because
 * one of them can still be acted on today.
 */
function rank(entry: { kind: "task" | "expiry"; daysLeft: number | null }): number {
  if (entry.daysLeft === null) return Number.MAX_SAFE_INTEGER;
  return entry.daysLeft * 2 + (entry.kind === "expiry" ? 1 : 0);
}
