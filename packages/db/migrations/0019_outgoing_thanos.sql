ALTER TABLE "items" ADD COLUMN "avatar_storage_key" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "avatar_dek_wrapped" "bytea";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "avatar_iv" "bytea";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "avatar_tag" "bytea";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "avatar_mime" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "avatar_updated_at" timestamp with time zone;