"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OPENAI_COMPATIBLE_PRESETS, type SuggestionSettings, type SuggestionTestResult, type SuggestProvider } from "@harbor/shared";
import { api } from "@/lib/api-client";

const input = "h-10 w-full rounded-md border border-border-strong px-3 text-row";
const primary = "h-10 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-60";
const secondary = "h-10 rounded-md border border-border bg-ground px-4 text-row font-medium disabled:opacity-60";

const PROVIDERS: { id: SuggestProvider; label: string; note: string }[] = [
  { id: "none", label: "Off — nothing leaves this box", note: "Titles are guessed from the filename and sender. No document text is sent anywhere." },
  { id: "anthropic", label: "Anthropic", note: "Claude, straight from Anthropic. Around $0.007 a document on Sonnet." },
  { id: "openai-compatible", label: "An OpenAI-compatible endpoint", note: "OpenRouter, OpenAI, Groq, or a model on your own network." },
];

/**
 * Choosing where document text goes, in the app rather than in a file over ssh.
 *
 * Two things this screen has to be honest about, because the choice is a privacy decision and not
 * a technical one: that anything other than "off" sends the text of every document to somebody
 * else, and that a key can be tested before it is trusted.
 */
export function SuggestionsForm({ current }: { current: SuggestionSettings }) {
  const router = useRouter();
  const [provider, setProvider] = useState<SuggestProvider>(current.provider);
  const [preset, setPreset] = useState(() => guessPreset(current.baseUrl));
  const [model, setModel] = useState(current.model);
  const [baseUrl, setBaseUrl] = useState(current.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [tested, setTested] = useState<SuggestionTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const chosen = PROVIDERS.find((p) => p.id === provider)!;
  const presetInfo = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === preset)!;
  const needsKey = provider === "anthropic" || (provider === "openai-compatible" && presetInfo.needsKey);

  function applyPreset(id: string) {
    setPreset(id);
    const p = OPENAI_COMPATIBLE_PRESETS.find((x) => x.id === id)!;
    if (p.id !== "custom") {
      setBaseUrl(p.baseUrl);
      setModel(p.model);
    }
    setTested(null);
  }

  /** Omitting the key means "keep the one you have"; the browser is never told what it is. */
  function payload() {
    return {
      provider,
      model: model.trim(),
      baseUrl: provider === "openai-compatible" ? baseUrl.trim() : null,
      ...(apiKey ? { apiKey } : {}),
    };
  }

  async function test() {
    setBusy("test");
    setError(null);
    setTested(null);
    try {
      setTested(await api<SuggestionTestResult>("/settings/suggestions/test", { method: "POST", body: JSON.stringify(payload()) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      await api<SuggestionSettings>("/settings/suggestions", { method: "PATCH", body: JSON.stringify(payload()) });
      setApiKey("");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="label">Provider</span>
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as SuggestProvider);
            setTested(null);
            setSaved(false);
          }}
          className={input}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="text-small text-muted">{chosen.note}</span>
      </label>

      {provider === "openai-compatible" && (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="label">Endpoint</span>
            <select value={preset} onChange={(e) => applyPreset(e.target.value)} className={input}>
              {OPENAI_COMPATIBLE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="text-small text-muted">{presetInfo.note}</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Base URL</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" className={input} />
          </label>
        </>
      )}

      {provider !== "none" && (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="label">Model</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-sonnet-5" className={input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">API key {needsKey ? "" : "(optional here)"}</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              placeholder={current.apiKeySet ? "A key is stored — type a new one to replace it" : "Paste the key"}
              className={input}
            />
            <span className="text-small text-muted">
              {current.apiKeySet ? "Stored encrypted under this vault's master key. It is never shown again, here or anywhere else." : "Stored encrypted under this vault's master key, never sent back to the browser."}
            </span>
          </label>
        </>
      )}

      {provider !== "none" && (
        <p className="rounded-sm bg-surface px-3 py-2 text-small text-muted">
          The text of every document is sent to this provider so it can write a summary. That is the trade for the titles and dates; choosing
          <em> Off</em>, or a model on your own network, avoids it.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={test} disabled={busy !== null} className={secondary}>
          {busy === "test" ? "Testing…" : "Test"}
        </button>
        <button type="button" onClick={save} disabled={busy !== null} className={primary}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-small text-muted">Saved. New documents use it straight away.</span>}
      </div>

      {tested && <p className={`text-small ${tested.ok ? "text-muted" : "text-danger"}`}>{tested.ok ? "✓ " : ""}{tested.detail}</p>}
      {error && <p className="text-small text-danger">{error}</p>}
    </div>
  );
}

function guessPreset(baseUrl: string | null): string {
  if (!baseUrl) return "openrouter";
  const match = OPENAI_COMPATIBLE_PRESETS.find((p) => p.baseUrl && baseUrl.startsWith(p.baseUrl));
  return match?.id ?? "custom";
}
