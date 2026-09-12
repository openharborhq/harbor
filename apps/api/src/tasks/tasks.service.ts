import { Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { documents, items, tasks, users, type Db } from "@harbor/db";
import {
  isPressing,
  nextDueOn,
  todayIso,
  type CloseTask,
  type CreateTask,
  type ListTasksQuery,
  type Task,
  type TaskCount,
  type UpdateTask,
  normaliseCurrency,
} from "@harbor/shared";
import { AuditService } from "../audit/audit.service";
import { InjectDb } from "../db/db.module";

type Row = {
  task: typeof tasks.$inferSelect;
  documentTitle: string | null;
  itemLabel: string | null;
  createdByName: string | null;
  closedByName: string | null;
};

/**
 * Tasks — what a document says still has to be done (spec §8).
 *
 * The one rule that shapes every query here: a task whose document has been soft-deleted must not
 * appear. The foreign key cascades on a *hard* delete only, and `documents.deleted_at` is the one
 * that actually happens, so every read joins and excludes rather than trusting the constraint.
 */
@Injectable()
export class TasksService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(query: Partial<ListTasksQuery> = {}): Promise<Task[]> {
    const where = and(
      // A live document, or none at all — a fetch reminder has no document and must survive this.
      or(isNull(tasks.documentId), isNull(documents.deletedAt)),
      query.status ? eq(tasks.status, query.status) : sql`true`,
      query.document ? eq(tasks.documentId, query.document) : sql`true`,
      query.item ? eq(tasks.itemId, query.item) : sql`true`,
    );
    const creator = alias(users, "creator");
    const closer = alias(users, "closer");
    const rows = await this.db
      .select({
        task: tasks,
        documentTitle: documents.title,
        itemLabel: items.label,
        createdByName: creator.displayName,
        closedByName: closer.displayName,
      })
      .from(tasks)
      .leftJoin(documents, eq(documents.id, tasks.documentId))
      .leftJoin(items, eq(items.id, tasks.itemId))
      .leftJoin(creator, eq(creator.id, tasks.createdBy))
      .leftJoin(closer, eq(closer.id, tasks.closedBy))
      .where(where)
      // Undated tasks last, then soonest first; closed ones newest first so "what did we just
      // settle" is at the top of the Done list.
      .orderBy(sql`${tasks.dueOn} asc nulls last`, desc(tasks.closedAt), asc(tasks.createdAt))
      .limit(query.limit ?? 200);
    return rows.map(toTask);
  }

  async get(taskId: string): Promise<Task> {
    const found = (await this.list({ limit: 500 })).find((t) => t.id === taskId);
    if (!found) throw new NotFoundException("To-do not found");
    return found;
  }

  /** Everything still open on one document, for the document detail strip. */
  forDocument(documentId: string): Promise<Task[]> {
    return this.list({ document: documentId, limit: 50 });
  }

  /**
   * The badge, and the line under the page title.
   *
   * `pressing` counts overdue and due-today only — the shared `isPressing` is used rather than a
   * second SQL predicate, so the number in the sidebar and the rows on the page are decided by
   * one piece of code.
   */
  async count(): Promise<TaskCount> {
    const open = await this.list({ status: "open", limit: 500 });
    const today = todayIso();
    const byCurrency = new Map<string, number>();
    for (const t of open) {
      if (t.amountCents === null) continue;
      // Amounts with no stated currency are a group of their own, not euros by assumption.
      const key = t.currency ?? "";
      byCurrency.set(key, (byCurrency.get(key) ?? 0) + t.amountCents);
    }
    return {
      pressing: open.filter((t) => isPressing(t.dueOn, today)).length,
      open: open.length,
      unpaid: [...byCurrency].map(([currency, cents]) => ({ currency, cents })).sort((a, b) => b.cents - a.cents),
    };
  }

  async create(input: CreateTask, actorUserId: string, ip: string | null = null, source: "manual" | "suggested" = "manual"): Promise<Task> {
    const [row] = await this.db
      .insert(tasks)
      .values({
        title: input.title,
        kind: input.kind,
        dueOn: input.dueOn,
        amountCents: input.amountCents,
        currency: input.currency,
        repeat: input.repeat,
        documentId: input.documentId,
        itemId: input.itemId,
        notes: input.notes,
        source,
        createdBy: actorUserId,
      })
      .returning();
    await this.audit.record({
      action: "task.create",
      actorUserId,
      entityType: "task",
      entityId: row!.id,
      metadata: { title: row!.title, dueOn: row!.dueOn, source },
      ip,
    });
    return this.get(row!.id);
  }

  async update(taskId: string, patch: UpdateTask, actorUserId: string, ip: string | null = null): Promise<Task> {
    const existing = await this.get(taskId);
    await this.db
      .update(tasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
    await this.audit.record({
      action: "task.update",
      actorUserId,
      entityType: "task",
      entityId: taskId,
      metadata: { fields: Object.keys(patch), was: { title: existing.title, dueOn: existing.dueOn } },
      ip,
    });
    return this.get(taskId);
  }

  /**
   * Close one — done, or dismissed.
   *
   * Nothing is deleted: the row keeps who settled it and when, because "did we ever pay that?" is
   * exactly the question a vault should still be able to answer next year. A repeating task that
   * is *done* also inserts its successor, dated from the occurrence just closed rather than from
   * today, so a bill paid three days late does not drag the whole series three days later. A
   * dismissed one ends the series — dismissing means the obligation was not ours to begin with.
   */
  async close(taskId: string, input: CloseTask, actorUserId: string, ip: string | null = null): Promise<{ task: Task; next: Task | null }> {
    const existing = await this.get(taskId);
    await this.db
      .update(tasks)
      .set({
        status: input.status,
        closedAt: new Date(),
        closedBy: actorUserId,
        closedReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    let next: Task | null = null;
    if (input.status === "done" && existing.repeat && existing.dueOn) {
      next = await this.create(
        {
          title: existing.title,
          kind: existing.kind,
          dueOn: nextDueOn(existing.dueOn, existing.repeat),
          amountCents: existing.amountCents,
          currency: normaliseCurrency(existing.currency),
          repeat: existing.repeat,
          documentId: existing.document?.id ?? null,
          itemId: existing.item?.id ?? null,
          notes: null,
        },
        actorUserId,
        ip,
        existing.source,
      );
    }

    await this.audit.record({
      action: input.status === "done" ? "task.done" : "task.dismiss",
      actorUserId,
      entityType: "task",
      entityId: taskId,
      metadata: { title: existing.title, reason: input.reason, nextTaskId: next?.id ?? null },
      ip,
    });
    return { task: await this.get(taskId), next };
  }

  /** Ticked the wrong row. Reopening keeps the audit trail of both the close and the undo. */
  async reopen(taskId: string, actorUserId: string, ip: string | null = null): Promise<Task> {
    await this.get(taskId);
    await this.db
      .update(tasks)
      .set({ status: "open", closedAt: null, closedBy: null, closedReason: null, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
    await this.audit.record({ action: "task.reopen", actorUserId, entityType: "task", entityId: taskId, ip });
    return this.get(taskId);
  }

  /**
   * Hard delete, for a to-do that should never have existed — a misread date, a duplicate. This is
   * not how a finished obligation goes away; that is `close`, which keeps the record.
   */
  async remove(taskId: string, actorUserId: string, ip: string | null = null): Promise<void> {
    const existing = await this.get(taskId);
    await this.db.delete(tasks).where(eq(tasks.id, taskId));
    await this.audit.record({
      action: "task.delete",
      actorUserId,
      entityType: "task",
      entityId: taskId,
      metadata: { title: existing.title },
      ip,
    });
  }
}

function toTask(row: Row): Task {
  const t = row.task;
  return {
    id: t.id,
    title: t.title,
    kind: t.kind,
    dueOn: t.dueOn,
    amountCents: t.amountCents,
    currency: t.currency,
    repeat: t.repeat,
    status: t.status,
    document: t.documentId && row.documentTitle !== null ? { id: t.documentId, title: row.documentTitle } : null,
    item: t.itemId && row.itemLabel !== null ? { id: t.itemId, label: row.itemLabel } : null,
    notes: t.notes,
    source: t.source,
    createdAt: t.createdAt.toISOString(),
    createdBy: row.createdByName,
    closedAt: t.closedAt?.toISOString() ?? null,
    closedBy: row.closedByName,
    closedReason: t.closedReason,
  };
}
