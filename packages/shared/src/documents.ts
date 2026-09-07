import { z } from "zod/v4";
import { SuggestionView } from "./suggestions";

/** Mirrors document_files.processing_status (spec §1). */
export const ProcessingStatus = z.enum([
  "queued",
  "extracting",
  "ocr",
  "indexing",
  "suggesting",
  "ready",
  "failed",
]);
export type ProcessingStatus = z.infer<typeof ProcessingStatus>;

export const DocumentSource = z.enum(["upload", "email"]);
export type DocumentSource = z.infer<typeof DocumentSource>;

export const DocumentSummary = z.object({
  id: z.string().uuid(),
  title: z.string(),
  source: DocumentSource,
  /** Who emailed it, for `source = "email"`. Null for uploads. */
  mailFrom: z.string().nullable(),
  createdAt: z.string().datetime(),
  /** Bumped by edits and new versions; the Inbox orders by this so a re-upload surfaces. */
  updatedAt: z.string().datetime(),
  documentDate: z.string().date().nullable(),
  expiresAt: z.string().date().nullable(),
  notes: z.string().nullable(),
  /** null = Inbox */
  category: z.object({ id: z.string().uuid(), name: z.string(), path: z.string() }).nullable(),
  items: z.array(z.object({ id: z.string().uuid(), kind: z.string(), label: z.string() })),
  tags: z.array(z.string()),
  /** The latest suggestion for the current file, if any (spec §5). */
  suggestion: SuggestionView.nullable(),
  file: z.object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    originalFilename: z.string(),
    mimeType: z.string(),
    byteSize: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative().nullable(),
    processingStatus: ProcessingStatus,
    processingError: z.string().nullable(),
    /** 0..1 while OCR is running; null otherwise. */
    pageProgress: z.number().min(0).max(1).nullable(),
    /** True once a first-page preview exists at GET /documents/:id/thumbnail. */
    hasThumbnail: z.boolean(),
  }),
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

/** Response to a multipart upload. `duplicateOf` is set when the same bytes already exist (spec §2 stage 0). */
export const UploadResult = z.object({
  document: DocumentSummary,
  duplicateOf: z
    .object({ documentId: z.string().uuid(), title: z.string(), addedAt: z.string().datetime() })
    .nullable(),
});
export type UploadResult = z.infer<typeof UploadResult>;

/** PATCH /documents/:id — every field optional; `categoryId: null` moves it back to the Inbox. */
export const UpdateDocument = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  itemIds: z.array(z.string().uuid()).max(20).optional(),
  documentDate: z.string().date().nullable().optional(),
  expiresAt: z.string().date().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});
export type UpdateDocument = z.infer<typeof UpdateDocument>;

/** "Accept & file" sends whatever is in the card's dropdowns; they win over the suggestion. */
export const AcceptSuggestion = z.object({
  categoryId: z.string().uuid().optional(),
  itemIds: z.array(z.string().uuid()).max(20).optional(),
});
export type AcceptSuggestion = z.infer<typeof AcceptSuggestion>;

export const AcceptAllResult = z.object({ accepted: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() });
export type AcceptAllResult = z.infer<typeof AcceptAllResult>;

export const DocumentVersion = z.object({
  fileId: z.string().uuid(),
  version: z.number().int().positive(),
  isCurrent: z.boolean(),
  originalFilename: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int().nonnegative(),
  pageCount: z.number().int().nonnegative().nullable(),
  processingStatus: ProcessingStatus,
  createdAt: z.string().datetime(),
  uploadedBy: z.string().nullable(),
});
export type DocumentVersion = z.infer<typeof DocumentVersion>;

export const DocumentText = z.object({
  fileId: z.string().uuid(),
  engine: z.string().nullable(),
  chars: z.number().int().nonnegative(),
  text: z.string(),
});
export type DocumentText = z.infer<typeof DocumentText>;

export const ActivityEntry = z.object({
  id: z.number().int(),
  action: z.string(),
  actor: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;

/** A document this owner opened recently — enough to recognise and get back to it. */
export const RecentDocument = z.object({
  documentId: z.string().uuid(),
  title: z.string(),
  categoryPath: z.string().nullable(),
  viewedAt: z.string().datetime(),
  hasThumbnail: z.boolean(),
  version: z.number().int().positive(),
});
export type RecentDocument = z.infer<typeof RecentDocument>;

export const DeletedDocument = z.object({
  id: z.string().uuid(),
  title: z.string(),
  categoryPath: z.string().nullable(),
  deletedAt: z.string().datetime(),
  originalFilename: z.string(),
});
export type DeletedDocument = z.infer<typeof DeletedDocument>;

/** GET /documents query. `category` includes its subcategories. */
export const ListDocumentsQuery = z.object({
  inbox: z.enum(["1", "true"]).optional(),
  category: z.string().uuid().optional(),
  item: z.string().uuid().optional(),
  source: DocumentSource.optional(),
  sort: z.enum(["newest", "oldest", "title", "date", "expires"]).default("newest"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuery>;

/**
 * The title a document gets from its filename at intake (spec §2 stage 0) — `INV-2026-00417`,
 * `R-2026-0147`. Placeholder, not a name.
 *
 * Shared rather than duplicated because `displayTitle` below has to recognise one, and a second
 * copy that drifted would make it stop recognising them.
 */
export function titleFromFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? name).replace(/\.[a-z0-9]{2,5}$/i, "");
  const cleaned = base.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Untitled document").slice(0, 120);
}

/**
 * What to call a document on screen — one rule, used everywhere a document is named, so the Inbox
 * card and the document it opens can never disagree.
 *
 * A stored title that is still exactly what the filename produced is a placeholder nobody chose,
 * so a pending suggestion's title is better and wins. Anything else is a title someone settled on
 * — typed by hand, or copied over by accepting a suggestion — and nothing overrides it.
 *
 * This keeps §5 intact: the model's title is displayed, never written to `documents`, and the
 * moment a person types their own it takes over for good.
 */
export function displayTitle(doc: Pick<DocumentSummary, "title" | "file" | "suggestion">): string {
  const suggested = doc.suggestion && !doc.suggestion.acceptedAt && !doc.suggestion.rejectedAt ? doc.suggestion.payload.title?.trim() : null;
  if (!suggested) return doc.title;
  return doc.title === titleFromFilename(doc.file.originalFilename) ? suggested : doc.title;
}

/** Clearing out a batch at once — the Inbox's answer to a backfill that filed more than you want. */
export const BulkDeleteDocuments = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
export type BulkDeleteDocuments = z.infer<typeof BulkDeleteDocuments>;

/**
 * Did the model think this is something a household keeps at all (spec §5, `keep`)?
 *
 * A mailbox hands over every attachment a sender chose to include, and a good share of them are
 * leaflets, newsletters and safety notices that arrived alongside the bill. They are not wrong
 * to have downloaded — you cannot tell without reading them — but they should not sit in the
 * queue of things awaiting a decision. An undecided suggestion is the only thing that can move a
 * document out of the way: once you accept or reject one, your judgement stands.
 */
export function looksLikeClutter(doc: Pick<DocumentSummary, "suggestion">): boolean {
  const s = doc.suggestion;
  return Boolean(s && !s.acceptedAt && !s.rejectedAt && s.payload.keep === "not_paperwork");
}
