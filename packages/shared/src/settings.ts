import { z } from "zod/v4";

export const SuggestProvider = z.enum(["none", "anthropic", "openai-compatible"]);
export type SuggestProvider = z.infer<typeof SuggestProvider>;

/**
 * Ready-made endpoints for the OpenAI-compatible provider, so the common cases are a choice
 * rather than a URL to remember. `custom` is the escape hatch, and Ollama is the one that keeps
 * every document on your own network.
 */
export const OPENAI_COMPATIBLE_PRESETS = [
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-5", needsKey: true, note: "One key, most models. Your documents pass through OpenRouter." },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5", needsKey: true, note: "Straight to OpenAI." },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", needsKey: true, note: "Fast and cheap; open models." },
  { id: "ollama", label: "Ollama on your network", baseUrl: "http://ollama:11434/v1", model: "llama3.1:8b", needsKey: false, note: "Nothing leaves your network. Needs a machine that can run the model." },
  { id: "custom", label: "Something else", baseUrl: "", model: "", needsKey: false, note: "Any server speaking /v1/chat/completions." },
] as const;
export type OpenAiCompatiblePreset = (typeof OPENAI_COMPATIBLE_PRESETS)[number]["id"];

/** What Settings shows. The key itself is never sent to the browser — only whether one is held. */
export const SuggestionSettings = z.object({
  provider: SuggestProvider,
  model: z.string(),
  baseUrl: z.string().nullable(),
  apiKeySet: z.boolean(),
  sendPeople: z.boolean(),
  readerLanguage: z.string(),
  /** True when these come from the environment because nothing has been saved here yet. */
  fromEnvironment: z.boolean(),
});
export type SuggestionSettings = z.infer<typeof SuggestionSettings>;

export const UpdateSuggestionSettings = z.object({
  provider: SuggestProvider,
  model: z.string().trim().max(200).optional(),
  baseUrl: z.string().trim().max(500).nullable().optional(),
  /** Omit to keep the stored key; empty string to clear it. */
  apiKey: z.string().max(500).optional(),
  sendPeople: z.boolean().optional(),
  readerLanguage: z.string().trim().min(2).max(8).optional(),
});
export type UpdateSuggestionSettings = z.infer<typeof UpdateSuggestionSettings>;

export const SuggestionTestResult = z.object({
  ok: z.boolean(),
  /** What the model called itself, when it answered. */
  model: z.string().nullable(),
  detail: z.string(),
});
export type SuggestionTestResult = z.infer<typeof SuggestionTestResult>;
