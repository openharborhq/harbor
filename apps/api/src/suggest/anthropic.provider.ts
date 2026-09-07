import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Logger } from "@nestjs/common";
import { SuggestionPayload } from "@trustworthier/shared";
import type { SuggestInput, SuggestOutput, SuggestionProvider } from "./provider";

/**
 * Claude via the official SDK with structured outputs (spec §5). The Zod schema in
 * @trustworthier/shared is both the output_config format and the validator, so the two cannot drift.
 * Stable system text and the vocabulary block come first and are cache-marked; the per-document
 * block comes last. Thinking is left adaptive; effort is low because this is extraction.
 */
export class AnthropicProvider implements SuggestionProvider {
  readonly name = "anthropic";
  private readonly log = new Logger(AnthropicProvider.name);
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async suggest(input: SuggestInput): Promise<SuggestOutput | null> {
    if (input.text.trim().length < 20) return null;

    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 1200,
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        { type: "text", text: vocabularyBlock(input), cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: documentBlock(input) }],
      // The helper is typed against zod v3 but converts with zod v4 at runtime (verified by the mocked
      // test); the shared schemas are v4, so the cast is a typing gap, not a behavioural one.
      output_config: { format: zodOutputFormat(SuggestionPayload as unknown as Parameters<typeof zodOutputFormat>[0]), effort: "low" },
    });

    if (response.stop_reason === "refusal") {
      const details = (response as { stop_details?: { category?: string | null } }).stop_details;
      this.log.warn(`model declined: ${details?.category ?? "unspecified"}`);
      return null;
    }
    if (!response.parsed_output) {
      this.log.warn(`no parseable output (stop_reason=${response.stop_reason})`);
      return null;
    }
    const parsed = SuggestionPayload.safeParse(response.parsed_output);
    if (!parsed.success) {
      this.log.warn(`output failed schema validation: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
      return null;
    }
    return {
      payload: parsed.data,
      model: response.model,
      inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  }
}

export const SYSTEM_PROMPT = `You file paperwork for one family's private document vault. For each document you receive extracted text (often OCR of a scan, so expect small errors) and you return a filing suggestion.

Rules:
- summary: at most two sentences, plain language, written in the reader's language given below, and starting with "Looks like". Name the sender/issuer, what the document is, the key amount or number, and the important date. Never guess; if the text does not say, leave it out.
- title: a short human title, at most 60 characters, no file names, no dates unless they are the point.
- categorySlug: choose exactly one slug from the CATEGORIES list, or null if none fits. Never invent a slug. If a category is genuinely missing, put a short name in newCategoryHint and still pick the closest existing slug or null.
- itemLabels: only labels from the ITEMS list that the document is *about* — the patient, the account holder, the pupil, the house the bill is for, the car being serviced. Not things merely mentioned. If an item has a parent (a boiler in a house), naming the child is enough; the parent is added for you. Empty list if unsure.
- documentDate: the date the document is dated (issue date), ISO YYYY-MM-DD, or null.
- expiresAt: only when the document itself states an expiry, renewal or due date that matters to keeping it (passport expiry, policy end, registration renewal). Payment due dates on bills count. Otherwise null.
- tags: up to three from the TAGS list only; empty if none apply.
- aliases: up to six other names a member of this household might type into search looking for this document, in BOTH the document's language and the reader's language. Include the everyday name for this kind of document, not only its formal one — an Abstammungsurkunde is also "birth certificate", "Geburtsurkunde" and "certificate of descent"; a KFZ-Versicherung is also "car insurance" and "auto policy". Name the document type, never its contents, and never repeat the title verbatim. Empty list if the document type is already obvious from the title in both languages.
- language: ISO 639-1 code of the document's language.
- confidence: high only when category, people and dates are all clear from the text; medium when the category is clear but something is missing; low otherwise.`;

function vocabularyBlock(input: SuggestInput): string {
  const cats = input.categories.map((c) => `- ${c.slug} — ${c.path}`).join("\n");
  const itemLines = input.items.length
    ? input.items.map((i) => `- ${i.label} (${i.kind}${i.parentLabel ? `, part of ${i.parentLabel}` : ""})`).join("\n")
    : "(not provided — leave itemLabels empty)";
  const tags = input.tags.length ? input.tags.join(", ") : "(none)";
  return `CATEGORIES (slug — name):\n${cats}\n\nITEMS — the people and things this family keeps paperwork for:\n${itemLines}\n\nTAGS: ${tags}\n\nReader's language: ${input.readerLanguage}`;
}

function documentBlock(input: SuggestInput): string {
  const meta = [
    `Filename: ${input.filename}`,
    `Arrived by: ${input.source}${input.senderAddress ? ` from ${input.senderAddress}` : ""}`,
    input.pageCount !== null ? `Pages: ${input.pageCount}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${meta}\n\nEXTRACTED TEXT (first ${input.text.length} characters):\n"""\n${input.text}\n"""`;
}
