-- Copy every person into `items` as kind 'person', keeping their id so all existing
-- foreign keys, links and key-document slots carry over untouched (spec §6).
-- People were the first instance of the items idea; this makes that literal.
INSERT INTO "items" ("id", "kind", "label", "details", "parent_id", "notes", "sort_order", "created_at")
SELECT
  p."id",
  'person',
  p."display_name",
  jsonb_strip_nulls(
    jsonb_build_object(
      'dateOfBirth', p."date_of_birth",
      'relationship', p."relationship"
    )
  ),
  NULL,
  p."notes",
  p."sort_order",
  p."created_at"
FROM "people" p
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "document_items" ("document_id", "item_id")
SELECT dp."document_id", dp."person_id" FROM "document_people" dp
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "item_key_documents" ("id", "item_id", "kind", "document_id", "sort_order", "created_at")
SELECT k."id", k."person_id", k."kind", k."document_id", k."sort_order", k."created_at"
FROM "person_key_documents" k
ON CONFLICT ("id") DO NOTHING;
