# 5. LLM integration — summarization & suggestions

The LLM pass is a **first-class v1 feature**, not a fallback-shaped extra. Every Inbox card
in the design carries a summary; this is what produces it.

## What it produces

One `suggestions` row per current `document_files` row, from a single structured call:

| Field | Constraint | Where it shows |
|---|---|---|
| `summary` | ≤ 2 sentences, plain language, the reader's language (default English), opens like the mockups: *"Looks like an electricity bill from Stadtwerke München for August 2026 — €84.20, due 15 September."* | Inbox card, Document detail |
| `title` | ≤ 60 chars, human, no filename noise | Inbox, Library |
| `category_slug` | **must be one of the vault's existing categories** or `null`; `new_category_hint` is a free-text side channel, never auto-created | FILE TO prefill |
| `item_labels[]` | subset of the vault's item list (people and things) | FOR prefill |
| `document_date`, `expires_at` | ISO dates or `null`; expiry only when the document states one | Home *Expiring soon*, item tables |
| `tags[]` | ≤ 3, from existing tags only | Detail |
| `confidence` | `high` / `medium` / `low` | *Accept all suggestions* takes `high` only |

Model output never writes to `documents`. Accepting copies fields over and stamps
`suggestions.accepted_at`; rejecting stamps `rejected_at`. Both are audited.

## Provider interface

```ts
interface SuggestionProvider {
  suggest(input: SuggestInput): Promise<SuggestOutput | null>; // null = no suggestion, not an error
}
```

Implementations: `anthropic` (v1), `none` (v1, heuristics only — sender→item, filename date→document date),
`ollama` (planned, for operators who want it fully local). Selected by config; the setup wizard
asks for an Anthropic API key and offers *Skip → none*.

## The `anthropic` provider

Official SDK `@anthropic-ai/sdk`, **structured outputs via `client.messages.parse` with
`zodOutputFormat(SuggestionSchema)`** — the Zod schema lives in `packages/shared` and is the
same one the API validates against. No prompt-parsing of JSON, no prefill.

- **Model:** `claude-opus-5`. Adaptive thinking left on; `output_config.effort: "low"` — this is
  extraction, not reasoning, and low effort on a current model beats disabling thinking.
  Operators can set `claude-haiku-4-5` for ~5× lower cost.
- **Prompt shape, in cache order:** stable system prompt (role, output rules, tone) → the vault's
  category list and item labels (changes rarely; `cache_control: ephemeral`) → the
  per-document block: filename, source (`upload` / `email from <addr>`), page count, and the
  first ~4 000 characters of extracted text. Nothing after the cache breakpoint is reused.
- **Refusals & fallbacks:** check `stop_reason` before reading output; `"refusal"` → `null`
  suggestion, logged. Server-side fallbacks (`fallbacks: "default"`) enabled by default so a
  classifier refusal on Opus reroutes rather than leaving the card blank.
- **Errors:** most-specific-first chain — `RateLimitError` / 5xx / `APIConnectionError` retry with
  backoff (BullMQ, 5 attempts); `BadRequestError` fails permanently and surfaces on the card.
  60 s timeout per call.
- **Idempotency:** unique on `(document_file_id, model, prompt_version)`. *Re-suggest* bumps
  nothing — it deletes the pending row and re-enqueues.
- **Backfill:** re-running a new prompt or model over the whole vault goes through the
  **Message Batches API at 50 % cost**, keyed by `custom_id = document_file_id`.

## What leaves the house — stated plainly

Per document: filename, sender address (email-in), page count, the first ~4 000 characters of
OCR text, and the vault's category names and **item labels** — people's first names among
them. That last item is PII about people who never consented; operators can disable sending
the item list (the FOR
prefill then falls back to sender heuristics). Nothing else — no images, no full documents.

Auditability without a second plaintext copy: `suggestions` records `model`,
`prompt_version`, `text_char_range`, `input_tokens`, `output_tokens`. What was sent is
reconstructible from `document_text` + those fields; it is not stored twice.

## Cost (Anthropic list prices, Sep 2026)

~2 500 input tokens (system + lists + text) and ~200 output tokens per document.

| Model | Per document | 500-doc backfill (Batches, −50 %) | ~30 docs/month |
|---|---|---|---|
| `claude-opus-5` | ≈ $0.018 | ≈ $4.50 | ≈ $0.55 |
| `claude-haiku-4-5` | ≈ $0.0035 | ≈ $0.90 | ≈ $0.10 |

Prompt caching cuts the system + list portion on repeated calls further. Cost is not a reason
to skip this; the exposure decision is the only real one, and it is made.

## Where it runs

The `suggester` container — the only processing container with internet egress, allow-listed
to `api.anthropic.com`. It reads `document_text`, never blobs, and never runs OCR tooling.
The OCR `worker` has no route to the internet at all (§3.6).
