CREATE TABLE IF NOT EXISTS "email_ingest_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"imap_uid" integer,
	"folder" text DEFAULT 'INBOX' NOT NULL,
	"tier" integer,
	"from_addr" text NOT NULL,
	"subject" text,
	"status" text NOT NULL,
	"held_reason" text,
	"raw_blob_key" text,
	"document_ids" uuid[] DEFAULT '{}' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"email_address" text NOT NULL,
	"kind" text DEFAULT 'inbox' NOT NULL,
	"provider_hint" text,
	"imap_host" text NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"imap_username" text NOT NULL,
	"secret_enc" text NOT NULL,
	"scope_mode" text DEFAULT 'folder' NOT NULL,
	"folders" text[] DEFAULT '{"INBOX"}' NOT NULL,
	"write_back" text DEFAULT 'none' NOT NULL,
	"retention_days" integer,
	"backfill_started_at" timestamp with time zone,
	"backfill_completed_at" timestamp with time zone,
	"status" text DEFAULT 'ok' NOT NULL,
	"status_detail" text,
	"last_ok_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"uidvalidity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"from_addr" text NOT NULL,
	"decision" text DEFAULT 'hold' NOT NULL,
	"default_category_slug" text,
	"default_item_labels" text[] DEFAULT '{}' NOT NULL,
	"default_tags" text[] DEFAULT '{}' NOT NULL,
	"learned_from" text DEFAULT 'manual' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_ingest_log" ADD CONSTRAINT "email_ingest_log_connection_id_mail_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mail_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_connections" ADD CONSTRAINT "mail_connections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_senders" ADD CONSTRAINT "mail_senders_connection_id_mail_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mail_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_ingest_message_idx" ON "email_ingest_log" USING btree ("connection_id","message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_ingest_status_idx" ON "email_ingest_log" USING btree ("connection_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_connections_owner_idx" ON "mail_connections" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mail_senders_conn_addr_idx" ON "mail_senders" USING btree ("connection_id","from_addr");