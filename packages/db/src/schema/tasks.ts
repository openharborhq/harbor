import { sql } from "drizzle-orm";
import { pgTable, uuid, text, bigint, date, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { documents } from "./documents";
import { items } from "./vocabulary";

/**
 * What a document says still has to be *done* (spec §8): a bill to pay, a form to return, a
 * registration to renew, a statement to fetch from a portal.
 *
 * Its own table rather than columns on `documents`, for three reasons that all turned out to
 * matter: one document can carry two deadlines (a tax assessment says pay by the 14th and object
 * by the 28th); some obligations have no document at all (the portal notification that says a
 * statement is ready); and a completion has an actor and a time, which is a row, not a column.
 * It is also what makes "did we ever pay that?" answerable a year later.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    kind: text("kind", { enum: ["pay", "file", "renew", "fetch", "review"] }).notNull().default("review"),
    /** Nullable: a task with no deadline is still a task. */
    dueOn: date("due_on"),
    /** Minor units. bigint for the same reason `byte_size` is one — no float ever touches money. */
    amountCents: bigint("amount_cents", { mode: "number" }),
    currency: text("currency"),
    /** A named cadence, not an interval: completing one inserts the next row. No scheduler. */
    repeat: text("repeat", { enum: ["monthly", "quarterly", "yearly", "two_yearly"] }),
    /**
     * Cascade on purpose. A to-do about a document that no longer exists is noise, and the
     * document's own soft delete keeps the honest history — `deleted_at` is what a restore reads.
     * Every query here still has to exclude soft-deleted documents itself.
     */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    /** The house the bill is for, the car being inspected. Survives the item being deleted. */
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    /**
     * Three states, not two. Dismissed means "not ours" — settled by the landlord, already paid
     * by someone else — and must never be shown as done.
     */
    status: text("status", { enum: ["open", "done", "dismissed"] }).notNull().default("open"),
    /** Where it came from. `suggested` means a person accepted a model's proposal, not that the model wrote it. */
    source: text("source", { enum: ["manual", "suggested"] }).notNull().default("manual"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set together when the task leaves `open`, whichever way it left. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    closedReason: text("closed_reason"),
  },
  (t) => [
    // The list's own query: everything still open, soonest first.
    index("tasks_open_due_idx").on(t.dueOn).where(sql`status = 'open'`),
    index("tasks_document_idx").on(t.documentId),
    index("tasks_item_idx").on(t.itemId),
  ],
);
