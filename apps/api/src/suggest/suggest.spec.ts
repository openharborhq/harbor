import { test } from "node:test";
import assert from "node:assert/strict";
import { SuggestionPayload } from "@trustworthier/shared";
import { AnthropicProvider } from "./anthropic.provider";
import { NoneProvider, dateFromFilename, firstDateInText, guessCategory } from "./none.provider";
import type { SuggestInput } from "./provider";

const input: SuggestInput = {
  filename: "stadtwerke-strom-2026-08.pdf",
  source: "upload",
  senderAddress: null,
  pageCount: 2,
  text: "Stadtwerke Muenchen Rechnung Stromlieferung August 2026 Kunde: Anna Muster Zaehlerstand 01.08.2026 Betrag 84,20 EUR",
  categories: [
    { slug: "real-estate", path: "Real Estate" },
    { slug: "real-estate/utilities", path: "Real Estate › Utilities" },
    { slug: "money/statements", path: "Money › Statements" },
  ],
  items: [
    { label: "Anna", kind: "person", parentLabel: null },
    { label: "Mara", kind: "person", parentLabel: null },
    { label: "Musterstraße 7", kind: "property", parentLabel: null },
  ],
  tags: ["school"],
  readerLanguage: "en",
};

test("none provider: category from keywords, person from text, date from filename, no summary", async () => {
  const out = await new NoneProvider().suggest(input);
  assert.ok(out);
  assert.equal(out.payload.categorySlug, "real-estate/utilities");
  assert.deepEqual(out.payload.itemLabels, ["Anna"]);
  assert.equal(out.payload.documentDate, "2026-08-01");
  assert.equal(out.payload.summary, "");
  assert.equal(out.payload.confidence, "medium");
  assert.ok(SuggestionPayload.safeParse(out.payload).success, "payload validates against the shared schema");
});

test("none provider falls back to the top-level category when the sub-slug is missing", () => {
  assert.equal(guessCategory("kfz versicherung police", ["insurance"]), "insurance");
  assert.equal(guessCategory("nothing relevant here", ["insurance"]), null);
  assert.equal(dateFromFilename("scan_2024-02-12.pdf"), "2024-02-12");
  assert.equal(dateFromFilename("IMG_4821.HEIC"), null);
  assert.equal(firstDateInText("am 12.02.2024 in München"), "2024-02-12");
});

test("anthropic provider: structured output is validated, usage is summed, refusal yields null", async () => {
  const calls: unknown[] = [];
  const payload: SuggestionPayload = {
    summary: "Looks like an electricity bill from Stadtwerke München for August 2026 — €84.20.",
    title: "Electricity bill — August 2026",
    categorySlug: "real-estate/utilities",
    newCategoryHint: null,
    itemLabels: ["Anna"],
    documentDate: "2026-08-01",
    expiresAt: "2026-09-15",
    tags: [],
    language: "de",
    confidence: "high",
  };
  const fake = {
    messages: {
      parse: async (req: unknown) => {
        calls.push(req);
        return { stop_reason: "end_turn", model: "claude-opus-5", parsed_output: payload, usage: { input_tokens: 1200, output_tokens: 180, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 } };
      },
    },
  };
  const provider = new AnthropicProvider("sk-test", "claude-opus-5", fake as never);
  const out = await provider.suggest(input);
  assert.ok(out);
  assert.equal(out.payload.categorySlug, "real-estate/utilities");
  assert.equal(out.inputTokens, 2000);
  assert.equal(out.outputTokens, 180);
  const req = calls[0] as { model: string; output_config: { effort: string }; system: { text: string; cache_control?: unknown }[]; messages: { content: string }[] };
  assert.equal(req.model, "claude-opus-5");
  assert.equal(req.output_config.effort, "low");
  assert.ok(req.system[1]!.cache_control, "vocabulary block is cache-marked");
  assert.match(req.system[1]!.text, /real-estate\/utilities/);
  assert.match(req.system[1]!.text, /Musterstraße 7 \(property\)/);
  assert.match(req.messages[0]!.content, /Stadtwerke/);

  const refusing = { messages: { parse: async () => ({ stop_reason: "refusal", stop_details: { category: "test" }, parsed_output: null, usage: { input_tokens: 0, output_tokens: 0 } }) } };
  assert.equal(await new AnthropicProvider("sk-test", "claude-opus-5", refusing as never).suggest(input), null);
});

test("anthropic provider skips near-empty text without calling the API", async () => {
  const provider = new AnthropicProvider("sk-test", "claude-opus-5", { messages: { parse: async () => assert.fail("should not call") } } as never);
  assert.equal(await provider.suggest({ ...input, text: "   " }), null);
});
