ALTER TABLE "document_files" ADD COLUMN "thumbnail_key" text;--> statement-breakpoint
ALTER TABLE "document_files" ADD COLUMN "thumbnail_iv" "bytea";--> statement-breakpoint
ALTER TABLE "document_files" ADD COLUMN "thumbnail_tag" "bytea";