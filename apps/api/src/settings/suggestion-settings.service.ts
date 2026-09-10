import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFileSync } from "node:fs";
import type { SuggestionSettings, SuggestionTestResult, SuggestProvider, UpdateSuggestionSettings } from "@harbor/shared";
import type { Env } from "../config/env";
import { AnthropicProvider } from "../suggest/anthropic.provider";
import { NoneProvider } from "../suggest/none.provider";
import { OpenAiCompatibleProvider } from "../suggest/openai-compatible.provider";
import type { SuggestionProvider } from "../suggest/provider";
import { SETTING, SettingsService } from "./settings.service";

export interface ResolvedSuggestConfig {
  provider: SuggestProvider;
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
  sendPeople: boolean;
  readerLanguage: string;
  fromEnvironment: boolean;
}

/**
 * Where the suggestion provider's configuration comes from: what an owner saved, falling back to
 * what the process was started with.
 *
 * Resolved on every use rather than at boot, which is the point — changing the provider in the
 * browser has to take effect without anyone restarting a container over ssh.
 */
@Injectable()
export class SuggestionSettingsService {
  private readonly log = new Logger(SuggestionSettingsService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async resolve(): Promise<ResolvedSuggestConfig> {
    const stored = await this.settings.getMany(Object.values(SETTING));
    const provider = (stored.get(SETTING.suggestProvider) ?? this.config.get("SUGGEST_PROVIDER", { infer: true })) as SuggestProvider;
    const envKey = provider === "anthropic" ? this.envKey("ANTHROPIC_API_KEY_FILE", "ANTHROPIC_API_KEY") : this.envKey("SUGGEST_API_KEY_FILE", "SUGGEST_API_KEY");
    return {
      provider,
      model: stored.get(SETTING.suggestModel) ?? this.config.get("SUGGEST_MODEL", { infer: true }),
      baseUrl: stored.get(SETTING.suggestBaseUrl) ?? this.config.get("SUGGEST_BASE_URL", { infer: true }) ?? null,
      apiKey: stored.get(SETTING.suggestApiKey) ?? envKey,
      sendPeople: bool(stored.get(SETTING.suggestSendPeople)) ?? this.config.get("SUGGEST_SEND_PEOPLE", { infer: true }),
      readerLanguage: stored.get(SETTING.suggestReaderLanguage) ?? this.config.get("SUGGEST_READER_LANGUAGE", { infer: true }),
      fromEnvironment: stored.size === 0,
    };
  }

  /** For Settings. The key never leaves the box, so only its presence is reported. */
  async view(): Promise<SuggestionSettings> {
    const c = await this.resolve();
    return {
      provider: c.provider,
      model: c.model,
      baseUrl: c.baseUrl,
      apiKeySet: Boolean(c.apiKey),
      sendPeople: c.sendPeople,
      readerLanguage: c.readerLanguage,
      fromEnvironment: c.fromEnvironment,
    };
  }

  async update(patch: UpdateSuggestionSettings): Promise<SuggestionSettings> {
    await this.settings.set(SETTING.suggestProvider, patch.provider);
    if (patch.model !== undefined) await this.settings.set(SETTING.suggestModel, patch.model || null);
    if (patch.baseUrl !== undefined) await this.settings.set(SETTING.suggestBaseUrl, patch.baseUrl || null);
    // An omitted key keeps the stored one; an empty string is a deliberate "forget it".
    if (patch.apiKey !== undefined) await this.settings.set(SETTING.suggestApiKey, patch.apiKey || null, { secret: true });
    if (patch.sendPeople !== undefined) await this.settings.set(SETTING.suggestSendPeople, String(patch.sendPeople));
    if (patch.readerLanguage !== undefined) await this.settings.set(SETTING.suggestReaderLanguage, patch.readerLanguage || null);
    this.log.log(`suggestion provider set to ${patch.provider}`);
    return this.view();
  }

  /** Build a provider from whatever is configured now. Never throws: `none` is always valid. */
  async build(): Promise<SuggestionProvider> {
    const c = await this.resolve();
    return buildFrom(c);
  }

  /**
   * Try the settings before they are saved, with a real call. The mail connection flow already
   * established that a credential you cannot test is a credential you find out about later, at
   * the worst moment.
   */
  async test(patch: UpdateSuggestionSettings): Promise<SuggestionTestResult> {
    const current = await this.resolve();
    const candidate: ResolvedSuggestConfig = {
      ...current,
      provider: patch.provider,
      model: patch.model || current.model,
      baseUrl: patch.baseUrl !== undefined ? patch.baseUrl : current.baseUrl,
      apiKey: patch.apiKey !== undefined ? patch.apiKey || null : current.apiKey,
    };
    if (candidate.provider === "none") {
      return { ok: true, model: null, detail: "Nothing to test: suggestions are off, and no document text leaves this box." };
    }
    let provider: SuggestionProvider;
    try {
      provider = buildFrom(candidate);
    } catch (err) {
      return { ok: false, model: null, detail: (err as Error).message };
    }
    try {
      const out = await provider.suggest({
        filename: "connection-test.pdf",
        source: "upload",
        senderAddress: null,
        pageCount: 1,
        text: "This is a connection test from Harbor. It is not a real document; answer briefly.",
        textTruncated: false,
        categories: [{ slug: "taxes/returns", path: "Taxes › Returns" }],
        items: [],
        tags: [],
        readerLanguage: candidate.readerLanguage,
      });
      if (!out) return { ok: false, model: null, detail: "The provider answered, but with nothing usable." };
      return { ok: true, model: out.model, detail: `Answered as ${out.model}${out.inputTokens ? ` · ${out.inputTokens} tokens in` : ""}. Ready to use.` };
    } catch (err) {
      return { ok: false, model: null, detail: explain(err as Error) };
    }
  }

  private envKey(fileVar: "ANTHROPIC_API_KEY_FILE" | "SUGGEST_API_KEY_FILE", envVar: string): string | null {
    const file = this.config.get(fileVar, { infer: true });
    try {
      const key = file ? readFileSync(file, "utf8").trim() : (process.env[envVar] ?? "").trim();
      return key || null;
    } catch {
      return null;
    }
  }
}

export function buildFrom(c: ResolvedSuggestConfig): SuggestionProvider {
  if (c.provider === "none") return new NoneProvider();
  if (c.provider === "openai-compatible") {
    if (!c.baseUrl) throw new Error("This provider needs a base URL, for example http://ollama:11434/v1");
    return new OpenAiCompatibleProvider(c.baseUrl, c.apiKey, c.model);
  }
  if (!c.apiKey) throw new Error("Anthropic needs an API key.");
  return new AnthropicProvider(c.apiKey, c.model);
}

function bool(v: string | undefined): boolean | undefined {
  return v === undefined ? undefined : v === "true";
}

/** Provider errors are shown to a person; the useful part is usually buried. */
function explain(err: Error): string {
  const m = err.message;
  if (/401|unauthorized|invalid.*api.?key/i.test(m)) return "The provider rejected the key.";
  if (/404|not found|model/i.test(m) && /model/i.test(m)) return `That model was not found: ${m}`;
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed/i.test(m)) return `Could not reach it: ${m}`;
  if (/429|rate/i.test(m)) return "The provider is rate limiting; the key works but it is busy.";
  return m;
}
