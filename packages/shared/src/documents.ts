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
  createdAt: z.string().datetime(),
  documentDate: z.string().date().nullable(),
  expiresAt: z.string().date().nullable(),
  notes: z.string().nullable(),
  /** null = Inbox */
  category: z.object({ id: z.string().uuid(), name: z.string(), path: z.string() }).nullable(),
  people: z.array(z.object({ id: z.string().uuid(), displayName: z.string() })),
  /** The latest suggestion for the current file, if any (spec §5). */
  suggestion: SuggestionView.nullable(),
  file: z.object({
    id: z.string().uuid(),
    originalFilename: z.string(),
    mimeType: z.string(),
    byteSize: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative().nullable(),
    processingStatus: ProcessingStatus,
    processingError: z.string().nullable(),
    /** 0..1 while OCR is running; null otherwise. */
    pageProgress: z.number().min(0).max(1).nullable(),
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
  personIds: z.array(z.string().uuid()).max(20).optional(),
  documentDate: z.string().date().nullable().optional(),
  expiresAt: z.string().date().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});
export type UpdateDocument = z.infer<typeof UpdateDocument>;

export const AcceptAllResult = z.object({ accepted: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() });
export type AcceptAllResult = z.infer<typeof AcceptAllResult>;
