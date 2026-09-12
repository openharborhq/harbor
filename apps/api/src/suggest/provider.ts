import type { SuggestionPayload } from "@harbor/shared";

/** Everything a provider may see (spec §5 "what leaves the house"). Nothing else is passed. */
export interface SuggestInput {
  filename: string;
  source: "upload" | "email";
  senderAddress: string | null;
  pageCount: number | null;
  /** The extracted text, sampled across the document's pages when it is longer than the budget. */
  text: string;
  /** True when `text` is a sample rather than the whole document, so the prompt can say so. */
  textTruncated: boolean;
  /** Vault vocabulary the model must choose from. */
  categories: { slug: string; path: string }[];
  /** The people and things the vault knows about (spec §6). Empty when SUGGEST_SEND_PEOPLE is off. */
  items: { label: string; kind: string; parentLabel: string | null }[];
  tags: string[];
  /** Reader's language for the summary, ISO 639-1. */
  readerLanguage: string;
}

export interface SuggestOutput {
  payload: SuggestionPayload;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface SuggestionProvider {
  readonly name: string;
  /** null = no suggestion (declined, empty text, disabled). Throw only for transient failures worth retrying. */
  suggest(input: SuggestInput): Promise<SuggestOutput | null>;
}

/** Bump when the prompt or schema changes so old suggestions can be told apart and re-run. */
export const PROMPT_VERSION = 7;
/**
 * Superseded by TEXT_BUDGET in ./sample-text. Kept only as the ceiling for a single page's worth
 * of text in tests that predate page-aware sampling.
 */
export const TEXT_CHARS = 4000;
