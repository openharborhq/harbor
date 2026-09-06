import { z } from "zod";

export const SearchQuery = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchHit = z.object({
  documentId: z.string().uuid(),
  title: z.string(),
  categoryPath: z.string().nullable(),
  documentDate: z.string().date().nullable(),
  source: z.enum(["upload", "email"]),
  /** ts_headline output with <mark>…</mark> around matches. */
  snippetHtml: z.string(),
  rank: z.number(),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchResponse = z.object({
  hits: z.array(SearchHit),
  total: z.number().int().nonnegative(),
  tookMs: z.number().int().nonnegative(),
});
export type SearchResponse = z.infer<typeof SearchResponse>;
