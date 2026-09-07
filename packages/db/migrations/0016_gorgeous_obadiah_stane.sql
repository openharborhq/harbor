CREATE TABLE IF NOT EXISTS "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text DEFAULT 'scheduled' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"snapshot_id" text,
	"bytes" bigint,
	"document_count" integer,
	"detail" jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_runs_started_idx" ON "backup_runs" USING btree ("started_at");