CREATE TABLE IF NOT EXISTS "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parent_id" uuid,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_items" (
	"document_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "document_items_document_id_item_id_pk" PRIMARY KEY("document_id","item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "item_key_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"document_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "document_people_person_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "person_key_documents_person_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "items" ADD CONSTRAINT "items_parent_id_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_items" ADD CONSTRAINT "document_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_items" ADD CONSTRAINT "document_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "item_key_documents" ADD CONSTRAINT "item_key_documents_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "item_key_documents" ADD CONSTRAINT "item_key_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_kind_idx" ON "items" USING btree ("kind","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_parent_idx" ON "items" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_items_item_idx" ON "document_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_key_documents_item_idx" ON "item_key_documents" USING btree ("item_id");