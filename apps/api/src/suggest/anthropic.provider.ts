import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Logger } from "@nestjs/common";
import { SuggestionPayload } from "@harbor/shared";
import { SYSTEM_PROMPT, documentBlock, vocabularyBlock } from "./prompt";
import type { SuggestInput, SuggestOutput, SuggestionProvider } from "./provider";

/**
 * Claude via the official SDK with structured outputs (spec §5). The Zod schema in
 * @harbor/shared is both the output_config format and the validator, so the two cannot drift.
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
