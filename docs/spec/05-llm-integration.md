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
| `aliases[]` | ≤ 6 other names for this *kind* of document, in the document's language and the reader's | search only, never shown |
| `document_date`, `expires_at` | ISO dates or `null`; expiry only when the document itself stops being valid — never a payment due date (§8) | Home *Needs attention*, item tables |
| `obligations` | ≤ 3 proposed to-dos: kind, title, due date, amount. Created only when a person accepts (§8) | `/todo`, the Inbox card's tick-box clause |
| `tags[]` | ≤ 3, from existing tags only | Detail |
| `confidence` | `high` / `medium` / `low` | *Accept all suggestions* takes `high` only |
| `keep` | `paperwork` / `not_paperwork`; borderline resolves to `paperwork` | Inbox holds `not_paperwork` back under *Probably not paperwork*, with a bulk delete |

`keep` is the one field that changes what the reader is shown rather than what is prefilled: a
mailbox hands over every attachment, and leaflets, newsletters and safety notices arrive beside
the bill. They are held back from the review queue — counted, one link away, deletable in bulk —
never deleted silently, and never on the strength of who sent them.

Model output never writes to `documents`. Accepting copies fields over and stamps
`suggestions.accepted_at`; rejecting stamps `rejected_at`. Both are audited.

## Provider interface

```ts
interface SuggestionProvider {
  suggest(input: SuggestInput): Promise<SuggestOutput | null>; // null = no suggestion, not an error
}
```

Two fields exist only to bridge languages: a household that reads English keeps German
paperwork, and neither the scan nor its title contains the words they would search for.

- **`summary`** is written in the reader's language, so it is the only English description an
  Abstammungsurkunde has. Indexed at weight C.
- **`aliases`** names the *document type* in both languages — for an Abstammungsurkunde the
  model returns "birth certificate", "Geburtsurkunde", "certificate of descent". Indexed at
  weight B, never displayed. The summary only helps when it happens to use the searched word;
  aliases are asked for directly, so they do not depend on luck.

Bumping `PROMPT_VERSION` changes what new documents are asked. Existing ones keep the answer they
gave to the older question until someone re-reads them deliberately — `node dist/suggester.js
rerun` (`--dry-run` first, it says how many). The same command covers a **provider change**, which
is the commoner case: a vault set up with `none` and pointed at a real model afterwards has a
heuristic guess on every document, and those count as needing a re-read. Nothing re-runs on deploy: at a hosted provider a
whole vault costs real money, and a document whose suggestion the reader already accepted or
rejected is skipped, because their judgement is the answer. The unique index on
`(document_file_id, provider, model, prompt_version)` keeps the old rows for comparison.

## Choosing a provider

Since v0.4.0 this is done in **Settings → Suggestions**, not in the environment: provider, model,
endpoint and key, with a *Test* button that makes a real call first. The key is sealed under the
KEK in `settings`, never returned to the browser, and the provider is resolved per document so a
change needs no restart. The environment remains the fallback for anything not saved there, which
is what keeps scripted provisioning and existing installs working.


**The operator picks the model, not the project.** Three implementations, and only three, no
matter how many services are on the list:

| Provider | Covers | Config |
|---|---|---|
| `anthropic` | Claude, via the official SDK | API key |
| `openai-compatible` | OpenAI, Groq, Together, OpenRouter, DeepSeek, Mistral, **Ollama**, llama.cpp, LM Studio — anything speaking `/v1/chat/completions` | Base URL, model name, optional API key |
| `none` | Heuristics only — sender→item, filename date→document date | — |

The commercial services are **presets in the settings UI, not code paths**: choosing "Groq"
fills in a base URL and a model name and then asks for a key. Adding a service is a row in a
table, never a provider class — the same move as the mail autodiscover list in §7.3. Ollama is
one of those presets pointing at `http://<host>:11434/v1`, with the key field hidden.

The setup wizard asks which, defaults the key field to *Skip → none*, and runs a live test call
against a fixed sample document before writing the config. A provider that cannot produce valid
structured output fails at setup, not on your first real document.

**Fully local is a first-class configuration.** Point `openai-compatible` at Ollama on the LAN
and no part of this stack talks to the internet at all — the knowing exception in §0 becomes
opt-in rather than the default. The trade is quality: a 7–8 B local model gives noticeably
weaker summaries and misses categories a frontier model gets right. That is the operator's call
to make, which is the point of offering it.

### What differs by provider, honestly

- **Structured output** is `client.messages.parse` + `zodOutputFormat` on Anthropic, and
  `response_format: { type: "json_schema", strict: true }` on OpenAI-compatible endpoints. Both
  validate against the *same* Zod schema in `packages/shared`. Many small local models comply
  loosely; output that fails validation becomes a `null` suggestion, which is already a drawn
  card state (§4), never a crash and never a half-filled form.
- **Prompt caching** (`cache_control: ephemeral`, §5's cache-ordered prompt) is Anthropic's.
  OpenAI caches automatically; most others not at all. The prompt order stays as specified —
  it costs nothing where caching is absent.
- **Batch backfill at 50 %** exists on Anthropic and OpenAI, nowhere else. Elsewhere a backfill
  is serial calls with the same idempotency key.
- **Refusals** are `stop_reason: "refusal"` on Anthropic and a `refusal` field on OpenAI;
  everything else just returns something unparseable. All three land on the same `null`.
- `suggestions` already stores `provider` and `model` separately, and the **unique index now
  includes `provider`** — `(document_file_id, provider, model, prompt_version)`. Two backends can
  return the same model string (`gpt-5` direct and through OpenRouter, any Llama tag), and
  re-running one must not overwrite the other's row. Both rows survive, so the outputs stay
  comparable.

## The `anthropic` provider

Official SDK `@anthropic-ai/sdk`, **structured outputs via `client.messages.parse` with
`zodOutputFormat(SuggestionSchema)`** — the Zod schema lives in `packages/shared` and is the
same one the API validates against. No prompt-parsing of JSON, no prefill.

- **Model:** `claude-opus-5`. Adaptive thinking left on; `output_config.effort: "low"` — this is
  extraction, not reasoning, and low effort on a current model beats disabling thinking.
  Operators can set `claude-sonnet-5` (~60 % cheaper) or `claude-haiku-4-5` (~80 %) — the task is
  constrained extraction against a fixed vocabulary with a validated schema, which is where a
  smaller model gives up least. The judgement calls are what degrade first: the summary reading
  naturally, the bilingual aliases, and `keep` on a genuinely borderline document.
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
| `claude-sonnet-5` | ≈ $0.007 | ≈ $1.75 | ≈ $0.21 |
| `claude-haiku-4-5` | ≈ $0.0035 | ≈ $0.90 | ≈ $0.10 |

Prompt caching cuts the system + list portion on repeated calls further. Cost is not a reason
to skip this; the exposure decision is the only real one, and it is now the operator's to make
rather than the project's — a local provider costs nothing and sends nothing.

## Where it runs

The `suggester` container — the only processing container with egress, allow-listed to **the
configured provider's host and nothing else**. With a local provider that host is on the LAN
and the container needs no internet route at all. It reads `document_text`, never blobs, and
never runs OCR tooling. The OCR `worker` has no route to the internet under any configuration
(§3.6).
