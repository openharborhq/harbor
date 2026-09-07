import { Logger } from "@nestjs/common";
import { SuggestionPayload } from "@harbor/shared";
import { z } from "zod/v4";
import { SYSTEM_PROMPT, documentBlock, vocabularyBlock } from "./prompt";
import type { SuggestInput, SuggestOutput, SuggestionProvider } from "./provider";

/**
 * Anything speaking `POST /chat/completions` (spec §5): OpenAI, Groq, Together, OpenRouter,
 * DeepSeek, Mistral, and — the reason this exists — Ollama, llama.cpp and LM Studio on the LAN,
 * where the vault talks to no one outside the house.
 *
 * Deliberately `fetch` and not the `openai` SDK. One POST does not justify a dependency in an
 * image that ships to other people's hardware, and the SDK's value (retries, timeouts) is already
 * covered by BullMQ above and AbortSignal below.
 *
 * The one real portability problem is structured output: OpenAI and recent Ollama accept
 * `json_schema`, older and smaller servers accept only `json_object`, and some accept neither.
 * Rather than make the operator find out which they have, a rejected `json_schema` request
 * degrades once, in place, and the schema moves into the prompt. Whatever comes back is validated
 * against the same Zod schema Claude's output is, so a loose local model costs a suggestion — the
 * Inbox's drawn no-suggestion state — never a bad one.
 */
export class OpenAiCompatibleProvider implements SuggestionProvider {
  readonly name = "openai-compatible";
  private readonly log = new Logger(OpenAiCompatibleProvider.name);
  private readonly endpoint: string;
  /** Set once a server has rejected json_schema, so the next document does not pay for the retry. */
  private jsonSchemaSupported = true;

  constructor(
    baseUrl: string,
    private readonly apiKey: string | null,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const base = baseUrl.replace(/\/+$/, "");
    this.endpoint = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  }

  async suggest(input: SuggestInput): Promise<SuggestOutput | null> {
    if (input.text.trim().length < 20) return null;

    let response = await this.post(input, this.jsonSchemaSupported);
    if (!response.ok && this.jsonSchemaSupported && rejectsJsonSchema(response.status)) {
      const detail = await response.text();
      this.log.warn(`server rejected json_schema (${response.status}), falling back to json_object for this and later documents: ${detail.slice(0, 200)}`);
      this.jsonSchemaSupported = false;
      response = await this.post(input, false);
    }
    if (!response.ok) {
      // Thrown, not swallowed: BullMQ retries transient failures and gives up loudly on the rest.
      throw new Error(`${this.endpoint} returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const body = (await response.json()) as ChatCompletion;
    const choice = body.choices?.[0];
    if (choice?.message?.refusal) {
      this.log.warn(`model declined: ${choice.message.refusal.slice(0, 200)}`);
      return null;
    }
    const content = choice?.message?.content;
    if (!content) {
      this.log.warn(`no content in response (finish_reason=${choice?.finish_reason ?? "none"})`);
      return null;
    }

    const parsed = parsePayload(content);
    if (!parsed.success) {
      this.log.warn(`output failed schema validation: ${parsed.error}`);
      return null;
    }
    return {
      payload: parsed.data,
      model: body.model ?? this.model,
      inputTokens: body.usage?.prompt_tokens ?? null,
      outputTokens: body.usage?.completion_tokens ?? null,
    };
  }

  private post(input: SuggestInput, useJsonSchema: boolean): Promise<Response> {
    const system = useJsonSchema
      ? `${SYSTEM_PROMPT}\n\n${vocabularyBlock(input)}`
      : `${SYSTEM_PROMPT}\n\n${vocabularyBlock(input)}\n\nReturn one JSON object and nothing else — no prose, no code fences — matching this JSON Schema exactly:\n${JSON.stringify(WIRE_SCHEMA)}`;

    return this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Local servers (Ollama, llama.cpp) want no key at all; sending an empty bearer breaks some.
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        // Stable text first so servers that cache on prompt prefix can.
        messages: [
          { role: "system", content: system },
          { role: "user", content: documentBlock(input) },
        ],
        max_tokens: 1200,
        temperature: 0,
        response_format: useJsonSchema
          ? { type: "json_schema", json_schema: { name: "filing_suggestion", strict: true, schema: WIRE_SCHEMA } }
          : { type: "json_object" },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  }
}

interface ChatCompletion {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** A 400/422 is how every server so far says "I don't do that response_format". 401/429/5xx are not that. */
function rejectsJsonSchema(status: number): boolean {
  return status === 400 || status === 422;
}

/**
 * Small models like to wrap JSON in ``` fences or add a sentence first, even when told not to.
 * Strip the fence, then take the outermost braces; anything still unparseable is a lost suggestion.
 */
export function parsePayload(content: string): { success: true; data: SuggestionPayload } | { success: false; error: string } {
  const unfenced = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) return { success: false, error: "no JSON object in the response" };

  let raw: unknown;
  try {
    raw = JSON.parse(unfenced.slice(start, end + 1));
  } catch (err) {
    return { success: false, error: `invalid JSON: ${(err as Error).message}` };
  }
  const parsed = SuggestionPayload.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") };
  return { success: true, data: parsed.data };
}

/**
 * OpenAI's strict mode accepts only a subset of JSON Schema: no length, size or pattern keywords,
 * every property required, no extra properties. Zod v4 already emits the last two; the rest are
 * stripped here. Nothing is lost by dropping them — the limits are stated in words in the prompt,
 * and SuggestionPayload still enforces them on the way back in.
 */
export function toStrictJsonSchema(schema: unknown): Record<string, unknown> {
  const UNSUPPORTED = new Set([
    "$schema",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minItems",
    "maxItems",
    "uniqueItems",
    "default",
  ]);

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (UNSUPPORTED.has(key)) continue;
      out[key] = walk(value);
    }
    if (out.type === "object" && out.properties && typeof out.properties === "object") {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties as Record<string, unknown>);
    }
    return out;
  };

  return walk(schema) as Record<string, unknown>;
}

/** Built once at import: the schema is fixed, and rebuilding it per document is pure waste. */
export const WIRE_SCHEMA = toStrictJsonSchema(z.toJSONSchema(SuggestionPayload));
