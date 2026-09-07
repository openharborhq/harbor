import { pgTable, uuid, text, integer, jsonb, timestamp, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";
import { documentFiles, documents } from "./documents";
import { people, tags } from "./vocabulary";

export const documentPeople = pgTable(
  "document_people",
  {
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.personId] }), index("document_people_person_idx").on(t.personId)],
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
 * Model output is a proposal, never written to `documents` directly (spec §1, §5).
 * `payload` is the validated SuggestionPayload from @trustworthier/shared.
 * What was sent is reconstructible from document_text + text_chars + prompt_version; it is not stored twice.
 */
export const suggestions = pgTable(
  "suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    documentFileId: uuid("document_file_id").notNull().references(() => documentFiles.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // 'anthropic' | 'none'
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
 * The documents a person is expected to have (spec §4.2). A NULL document renders as
 * "Not on file" — absence as a first-class thing on the person page.
 */
export const personKeyDocuments = pgTable(
  "person_key_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("person_key_documents_person_idx").on(t.personId)],
);
