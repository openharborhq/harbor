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

8. [x] **Delete an item**: `DELETE /items/:id` returns what it cost (documents unlinked,
       children detached); the confirmation states both before asking. Documents and children
       survive.
9. [x] **Notes on a document**, editable in place on the document detail rather than only
       through "Edit details", and indexed at weight B so they can be searched for.
10. [x] **Search staleness**: `SearchIndexService.reindex()` rebuilds `document_search` from
        Postgres alone. Wired into item delete and into document title/items/tags/notes edits,
        which until now only refreshed the index when the file was reprocessed.

11. [x] **Change or clear where an item sits** from its own page, with the API rejecting a
        person parent, self-parenting, and cycles. Nesting used to be set once at creation with
        no way back.

## Next

12. [ ] Reorder and rename items from the UI.
13. [ ] Kinds beyond the active four (`policy`, `pet`, `business`) in the add menus, once
       there is a real reason to surface them.
14. [ ] Update the Paper artboards whose sidebars and counts predate Purchases and items.
