import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  real,
  date,
  timestamp,
  customType,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    /** NULL = Inbox (spec §1). Categories table arrives in M4. */
    categoryId: uuid("category_id"),
    notes: text("notes"),
    documentDate: date("document_date"),
    expiresAt: date("expires_at"),
    source: text("source", { enum: ["upload", "email"] }).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("documents_inbox_idx").on(t.categoryId, t.createdAt)],
);

/** Immutable file versions. Blobs are never shared; sha256 is for duplicate *detection* only (spec §2). */
export const documentFiles = pgTable(
  "document_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    isCurrent: boolean("is_current").notNull().default(true),
    storageKey: text("storage_key").notNull().unique(), // uuid path under /data/blobs
    sha256: text("sha256").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    pageCount: integer("page_count"),
    // Envelope encryption (spec §3.3): AES-256-GCM DEK wrapped by the KEK.
    dekWrapped: bytea("dek_wrapped").notNull(),
    iv: bytea("iv").notNull(),
    authTag: bytea("auth_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    processingStatus: text("processing_status", {
      enum: ["queued", "extracting", "ocr", "indexing", "suggesting", "ready", "failed"],
    })
      .notNull()
      .default("queued"),
    processingError: text("processing_error"),
    pageProgress: real("page_progress"),
    // First-page preview, PNG, encrypted under the same DEK with its own IV (spec §3.3).
    thumbnailKey: text("thumbnail_key"),
    thumbnailIv: bytea("thumbnail_iv"),
    thumbnailTag: bytea("thumbnail_tag"),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("document_files_document_idx").on(t.documentId),
    index("document_files_sha256_idx").on(t.sha256),
    uniqueIndex("document_files_current_idx").on(t.documentId).where(sql`is_current`),
  ],
);

export const documentText = pgTable("document_text", {
  documentFileId: uuid("document_file_id")
    .primaryKey()
    .references(() => documentFiles.id, { onDelete: "cascade" }),
  textContent: text("text_content").notNull(),
  ocrEngine: text("ocr_engine"), // 'pdftotext' | 'ocrmypdf'
  ocrMs: integer("ocr_ms"),
  searchablePdfKey: text("searchable_pdf_key"),
  searchablePdfIv: bytea("searchable_pdf_iv"),
  searchablePdfTag: bytea("searchable_pdf_tag"),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Search index — a cache, rebuildable from source (spec §2 stage 3).
 * Weighted A=title, B=tags+people (M4), C=OCR text. Maintained by the worker, not a trigger,
 * so the weighting logic lives in one place.
 */
export const documentSearch = pgTable(
  "document_search",
  {
    documentId: uuid("document_id")
      .primaryKey()
      .references(() => documents.id, { onDelete: "cascade" }),
    tsv: tsvector("tsv").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("document_search_tsv_idx").using("gin", t.tsv)],
);
