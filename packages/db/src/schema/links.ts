import { pgTable, uuid, text, integer, jsonb, timestamp, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";
import { documentFiles, documents } from "./documents";
import { users } from "./auth";
import { items, tags } from "./vocabulary";

export const documentItems = pgTable(
  "document_items",
  {
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.itemId] }), index("document_items_item_idx").on(t.itemId)],
);

export const documentTags = pgTable(
  "document_tags",
  {
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.tagId] })],
);

/**
 * The documents an item is expected to have. A NULL document renders as "Not on file" —
 * absence as a first-class thing, for a passport on a person or a deed on a house (spec §6).
 */
export const itemKeyDocuments = pgTable(
  "item_key_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("item_key_documents_item_idx").on(t.itemId)],
);

/**
 * Model output is a proposal, never written to `documents` directly (spec §1, §5).
 * `payload` is the validated SuggestionPayload from @trustworthier/shared.
 */
export const suggestions = pgTable(
  "suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    documentFileId: uuid("document_file_id").notNull().references(() => documentFiles.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    textChars: integer("text_chars").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("suggestions_file_model_idx").on(t.documentFileId, t.model, t.promptVersion),
    index("suggestions_document_idx").on(t.documentId),
  ],
);

/**
 * Which documents each owner opened, and when. One row per (user, document) — reopening moves the
 * row rather than growing a log, so "Recent" is a short list of places to get back to, not history
 * to audit. The audit_log already answers who-looked-at-what.
 */
export const documentViews = pgTable(
  "document_views",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.documentId] }), index("document_views_recent_idx").on(t.userId, t.viewedAt)],
);
