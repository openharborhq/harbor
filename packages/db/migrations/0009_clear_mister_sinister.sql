-- gin_trgm_ops below needs the extension; it ships with Postgres but is not enabled by default.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "document_search" ADD COLUMN "terms" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_search_terms_trgm_idx" ON "document_search" USING gin ("terms" gin_trgm_ops);