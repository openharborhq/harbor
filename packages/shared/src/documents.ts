import { z } from "zod";

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
  categoryId: z.string().uuid().nullable(),
  source: DocumentSource,
  createdAt: z.string().datetime(),
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
