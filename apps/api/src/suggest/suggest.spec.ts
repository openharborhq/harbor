import { test } from "node:test";
import assert from "node:assert/strict";
import { SuggestionPayload } from "@harbor/shared";
import { AnthropicProvider } from "./anthropic.provider";
import { SYSTEM_PROMPT } from "./prompt";
import { PROMPT_VERSION } from "./provider";
import { NoneProvider, dateFromFilename, firstDateInText, guessCategory } from "./none.provider";
import { OpenAiCompatibleProvider, WIRE_SCHEMA, parsePayload } from "./openai-compatible.provider";
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
  assert.deepEqual(out.payload.aliases, [], "heuristics can't know synonyms");
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
    aliases: ["electricity bill", "Stromrechnung", "utility bill"],
    keep: "paperwork",
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
  assert.deepEqual(out.payload.aliases, ["electricity bill", "Stromrechnung", "utility bill"], "search aliases survive validation");
  assert.match(req.system[0]!.text, /aliases:/, "the prompt asks for aliases");

  const refusing = { messages: { parse: async () => ({ stop_reason: "refusal", stop_details: { category: "test" }, parsed_output: null, usage: { input_tokens: 0, output_tokens: 0 } }) } };
  assert.equal(await new AnthropicProvider("sk-test", "claude-opus-5", refusing as never).suggest(input), null);
});

test("anthropic provider skips near-empty text without calling the API", async () => {
  const provider = new AnthropicProvider("sk-test", "claude-opus-5", { messages: { parse: async () => assert.fail("should not call") } } as never);
  assert.equal(await provider.suggest({ ...input, text: "   " }), null);
});

const PAYLOAD: SuggestionPayload = {
  summary: "Looks like an electricity bill from Stadtwerke München for August 2026 — €84.20.",
  title: "Electricity bill — August 2026",
  categorySlug: "real-estate/utilities",
  newCategoryHint: null,
  itemLabels: ["Anna"],
  documentDate: "2026-08-01",
  expiresAt: "2026-09-15",
  tags: [],
  aliases: ["electricity bill", "Stromrechnung"],
  keep: "paperwork",
  language: "de",
  confidence: "high",
};

interface ChatRequest {
  model: string;
  messages: { role: string; content: string }[];
  response_format: { type: string; json_schema?: { name: string; strict: boolean; schema: Record<string, unknown> } };
}

/** A stub `fetch` that replays queued responses and records what it was sent. */
function stubFetch(...responses: { status: number; body: unknown }[]) {
  const calls: { url: string; headers: Record<string, string>; body: ChatRequest }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const next = responses.shift() ?? assert.fail("more requests than queued responses");
    return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const completion = (content: unknown, extra: Record<string, unknown> = {}) => ({
  model: "llama3.1:8b",
  choices: [{ finish_reason: "stop", message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
  usage: { prompt_tokens: 1400, completion_tokens: 160 },
  ...extra,
});

test("openai-compatible: posts to /chat/completions with a strict schema and validates the result", async () => {
  const { impl, calls } = stubFetch({ status: 200, body: completion(PAYLOAD) });
  const out = await new OpenAiCompatibleProvider("https://api.groq.com/openai/v1/", "gsk-test", "llama3.1:8b", impl).suggest(input);

  assert.ok(out);
  assert.equal(out.payload.categorySlug, "real-estate/utilities");
  assert.equal(out.model, "llama3.1:8b", "the server's own model string is recorded, not ours");
  assert.equal(out.inputTokens, 1400);
  assert.equal(out.outputTokens, 160);

  const req = calls[0]!;
  assert.equal(req.url, "https://api.groq.com/openai/v1/chat/completions", "trailing slash does not double up");
  assert.equal(req.headers.authorization, "Bearer gsk-test");
  const body = req.body;
  assert.equal(body.response_format.type, "json_schema");
  assert.ok(body.response_format.json_schema?.strict);
  assert.match(body.messages[0]!.content, /real-estate\/utilities/, "vocabulary rides in the system message");
  assert.match(body.messages[1]!.content, /Stadtwerke/);
});

test("openai-compatible: a server that rejects json_schema degrades to json_object, once", async () => {
  const { impl, calls } = stubFetch(
    { status: 400, body: { error: { message: "response_format.type must be 'json_object'" } } },
    { status: 200, body: completion(PAYLOAD) },
    { status: 200, body: completion(PAYLOAD) },
  );
  const provider = new OpenAiCompatibleProvider("http://ollama:11434/v1", null, "llama3.1:8b", impl);

  assert.ok(await provider.suggest(input), "recovers on the retry");
  assert.ok(await provider.suggest(input), "second document still works");
  assert.equal(calls.length, 3, "the degradation is remembered — only the first document pays for it");
  assert.equal(calls[1]!.body.response_format.type, "json_object");
  assert.match(calls[1]!.body.messages[0]!.content, /JSON Schema/, "the schema moves into the prompt");
  assert.equal(calls[0]!.headers.authorization, undefined, "no bearer header when there is no key");
});

test("openai-compatible: fenced or chatty output is recovered; unusable output is a null suggestion", async () => {
  const fenced = "```json\n" + JSON.stringify(PAYLOAD) + "\n```";
  assert.equal(parsePayload(fenced).success, true);
  assert.equal(parsePayload("Sure! Here you go:\n" + JSON.stringify(PAYLOAD)).success, true);
  assert.equal(parsePayload("I could not read that document.").success, false);
  assert.equal(parsePayload('{"summary": "x"}').success, false, "a partial object fails the shared schema");

  const { impl } = stubFetch({ status: 200, body: completion("not json at all") });
  assert.equal(await new OpenAiCompatibleProvider("http://x/v1", null, "m", impl).suggest(input), null);

  const refusing = stubFetch({ status: 200, body: { model: "m", choices: [{ message: { refusal: "I can't help with that." } }] } });
  assert.equal(await new OpenAiCompatibleProvider("http://x/v1", null, "m", refusing.impl).suggest(input), null);
});

test("openai-compatible: a 500 throws so the queue retries, an empty document never calls out", async () => {
  const { impl } = stubFetch({ status: 500, body: "upstream exploded" });
  await assert.rejects(() => new OpenAiCompatibleProvider("http://x/v1", null, "m", impl).suggest(input), /returned 500/);

  const never = (() => assert.fail("should not call")) as unknown as typeof fetch;
  assert.equal(await new OpenAiCompatibleProvider("http://x/v1", null, "m", never).suggest({ ...input, text: "  " }), null);
});

test("the wire schema is what OpenAI strict mode accepts", () => {
  const json = JSON.stringify(WIRE_SCHEMA);
  for (const banned of ["maxLength", "maxItems", "$schema", "pattern", "format"]) {
    assert.ok(!json.includes(banned), `${banned} would be rejected in strict mode`);
  }
  assert.equal(WIRE_SCHEMA.additionalProperties, false);
  assert.deepEqual(
    (WIRE_SCHEMA.required as string[]).sort(),
    Object.keys(WIRE_SCHEMA.properties as Record<string, unknown>).sort(),
    "strict mode requires every property to be required",
  );
  assert.ok((WIRE_SCHEMA.properties as Record<string, unknown>).aliases, "aliases still crosses the wire (spec §5)");
});

test("the prompt asks whether a document is worth keeping at all, and errs towards keeping", () => {
  // The gap this closes: "where does this go?" always has an answer, so a safety leaflet was
  // filed as confidently as an invoice. This is the question that was never asked.
  assert.match(SYSTEM_PROMPT, /keep: "paperwork"/, "the field is explained, not just declared");
  assert.match(SYSTEM_PROMPT, /leaflets|newsletters/, "names the things that merely arrived as attachments");
  assert.match(SYSTEM_PROMPT, /borderline.*paperwork/is, "a wrongly hidden bill costs more than a leaflet in the list");
  assert.match(SYSTEM_PROMPT, /not who sent it/, "a utility company also sends leaflets");

  // Heuristics cannot read the document, so they must not be the thing that hides one.
  assert.equal(PROMPT_VERSION, 4, "bumped so every existing document is re-judged");
});

test("the heuristic provider never hides a document it cannot judge", async () => {
  const out = await new NoneProvider().suggest(input);
  assert.equal(out?.payload.keep, "paperwork");
  assert.ok(SuggestionPayload.safeParse(out!.payload).success);
});

test("keep survives the openai-compatible round trip and reaches the wire schema", () => {
  assert.ok((WIRE_SCHEMA.properties as Record<string, unknown>).keep, "the model is actually asked for it");
  assert.ok((WIRE_SCHEMA.required as string[]).includes("keep"), "and cannot omit it");

  const parsed = parsePayload(JSON.stringify({ ...PAYLOAD, keep: "not_paperwork" }));
  assert.ok(parsed.success && parsed.data.keep === "not_paperwork");
  // An unknown value must fail the schema rather than being quietly treated as one or the other.
  assert.equal(parsePayload(JSON.stringify({ ...PAYLOAD, keep: "maybe" })).success, false);
});

test("a suggestion stored before a field existed still parses", () => {
  /**
   * The regression this guards: `SuggestionPayload` validates rows read back from the database,
   * not just model output, and the read path drops whatever it cannot parse. Adding `keep` as a
   * required field made every one of 273 stored suggestions fail at once, and every summary in
   * the app disappeared — with the data still sitting intact in the table.
   *
   * Any field added to this payload has to carry a default.
   */
  const beforeKeepExisted = {
    summary: "Looks like an electricity bill.",
    title: "Electricity bill",
    categorySlug: "real-estate/utilities",
    newCategoryHint: null,
    itemLabels: [],
    documentDate: null,
    expiresAt: null,
    tags: [],
    aliases: [],
    language: "de",
    confidence: "high",
  };
  const parsed = SuggestionPayload.safeParse(beforeKeepExisted);
  assert.ok(parsed.success, "an older row must not be silently discarded");
  assert.equal(parsed.data.keep, "paperwork", "and defaults to being kept, never hidden");
});
