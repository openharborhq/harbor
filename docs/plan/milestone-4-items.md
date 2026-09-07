# Milestone 4 — Items: people *and* things

Goal: a document can be about a house, a car or an account, not only a person. `people`
becomes `items` with a `kind`, things can nest, and the Inbox gains the single grouped FOR
control drawn as **Inbox — For people and things**. Spec: [§6](../spec/06-items.md).

## Done

1. [x] **Schema**: `items` (kind, label, `details` jsonb, self-referencing `parent_id`),
       `document_items`, `item_key_documents`. Three migrations on purpose — 0006 creates,
       0007 copies `people` across preserving ids, 0008 drops the legacy tables — so
       drizzle-kit never has to guess at a rename.
2. [x] **Shared**: `ItemKind`, `Item`, `CreateItem`/`UpdateItem`, `ITEM_KIND_LABEL`,
       `ACTIVE_ITEM_KINDS`, `NESTABLE_ITEM_KINDS`, `ITEM_DETAIL_FIELDS`,
       `DEFAULT_KEY_DOCUMENTS` per kind, `itemSubtitle()`.
3. [x] **API**: `ItemsService` replaces `PeopleService`; `GET/POST /items`, `?kind=` filter,
       `PATCH /items/:id`, key-document routes, and `GET /items/:id` (item + children +
       key documents + documents) in its own controller inside DocumentsModule so the
       global VocabularyModule stays free of blob storage — the suggester imports vocabulary
       and must never reach a document's bytes.
4. [x] **Suggester**: prompt version 2 lists items with kind and parent; `itemLabels`
       replaces `personNames`; resolving a child label adds its parent.
5. [x] **Web**: `/items` (grouped by kind, add form per kind, nesting via an "Inside"
       select), `/items/[id]` (key documents, "Inside <item>", all records), Home's
       Property & things row, the Library About rail grouped by kind, and `ItemPicker` —
       one searchable list, children last under their parent, picking a child implies it.
6. [x] **Inbox seeding**: FOR starts as the union of what the document already links and
       what the model proposed, so neither is silently dropped.
7. [x] **Bug**: killing the suggester mid-job stranded files in `suggesting` with their
       suggestion already stored. Storing the suggestion and leaving `suggesting` are now
       one transaction.

## Next

8. [ ] Reorder and rename items; delete an item that has no documents.
9. [ ] Kinds beyond the active four (`policy`, `pet`, `business`) in the add menus, once
       there is a real reason to surface them.
10. [ ] Update the Paper artboards whose sidebars and counts predate Purchases and items.
