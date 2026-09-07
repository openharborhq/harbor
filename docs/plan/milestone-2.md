# Milestone 2 — the Inbox as designed

**Definition of done:** a document lands in the Inbox and, within a minute, its card shows a
plain-language summary, a suggested title, a suggested category, and the family member it's
about — each accept-or-adjust — exactly like the Paper artboard. "Accept all suggestions" files
every high-confidence card in one click. With the provider set to `none`, the same card shows
the no-suggestion state with sender/filename heuristics. Every accept/reject is audited.

Categories and people are pulled forward from M4 because suggestions are constrained to them
(spec §5): the model may only pick from the vault's existing vocabulary.

## Work order

1. [x] Schema (migration 0002): `categories` (2 levels), `people`, `document_people`, `tags`,
       `document_tags`, `suggestions`. Default categories seeded on first boot from the design
       (Identity, Real Estate, Transportation, Money, Taxes, Insurance, Health, Legal & Estate,
       Work, Education, Travel — with their subcategories).
2. [x] Shared Zod: `Category`, `Person`, `SuggestionPayload` (the exact schema Claude returns),
       `DocumentDetail` (summary + category + people + suggestion), `UpdateDocument`.
3. [x] API: `GET/POST /categories`, `GET/POST /people`, documents now return category/people/
       suggestion; `PATCH /documents/:id`; `POST /documents/:id/suggestion/{accept,reject}`;
       `POST /documents/accept-all` (high confidence only). Audit on every change.
4. [x] Suggester: `SuggestionProvider` interface; `anthropic` provider via `@anthropic-ai/sdk`
       `messages.parse` + `zodOutputFormat`, `claude-opus-5`, `effort: low`, prompt caching on
       the stable prefix, refusal → `null`; `none` provider (sender → person, filename date →
       document date). Third entrypoint `suggester.ts` on a `suggest` queue; the worker enqueues
       after indexing and sets `processing_status = suggesting`; the suggester sets `ready`.
       Config: `SUGGEST_PROVIDER`, `SUGGEST_MODEL`, `SUGGEST_SEND_PEOPLE`, `ANTHROPIC_API_KEY_FILE`.
5. [x] Compose: `suggester` service (api image, own command) on internal + edge; only it and
       the future mailfetch/backup have a route out. Docker secret for the API key.
6. [x] Web: Inbox card with SUMMARY block, FILE TO (grouped category picker) and FOR (people
       chips) prefilled from the suggestion, Accept / adjust, "Accept all suggestions"; the three
       non-suggestion states from the mockups; People page (list + add); pinned categories with
       counts in the sidebar; document page gains the suggestion and editable details.
7. [~] Verified with provider `none` (heuristics) end to end on the dev Mac, 2026-09-07; `anthropic` is covered by a mocked provider test only — no API key on this machine. Still to do: run it with a real key and record tokens/cost. Original text: Verify with provider `none` (heuristics) and, if a key is available, with `anthropic`
       against the two fixtures. Record tokens and cost per document.
