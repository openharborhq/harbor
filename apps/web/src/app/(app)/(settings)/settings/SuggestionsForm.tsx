"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OPENAI_COMPATIBLE_PRESETS, type SuggestionSettings, type SuggestionTestResult, type SuggestProvider } from "@harbor/shared";
import { api } from "@/lib/api-client";
import { GroupLabel, Note } from "./ui";

const field = "h-[38px] w-full rounded-md border border-border-strong px-3 text-row";
const mono = `${field} font-mono text-small`;
const primary = "h-10 rounded-md bg-accent px-5 text-body font-semibold text-white disabled:opacity-60";
const secondary = "h-9 rounded-md border border-border-strong px-4 text-row font-medium disabled:opacity-60";

const PROVIDERS: { id: SuggestProvider; label: string; note: string }[] = [
  { id: "none", label: "Nobody — keep it off", note: "Titles are guessed from the filename and the sender. No document text leaves this box." },
  { id: "anthropic", label: "Anthropic", note: "Claude, straight from Anthropic. About €0.007 a document on Sonnet." },
  {
    id: "openai-compatible",
    label: "An OpenAI-compatible endpoint",
    note: "OpenRouter, OpenAI, Groq — or a model running on your own network, which sends nothing outside the house.",
  },
];

/**
 * Choosing where document text goes, in the app rather than in a file over ssh.
 *
 * Drawn as three choices that each state their consequence, with only the chosen one opened up:
 * this is a privacy decision before it is a technical one, and a screen of endpoint fields invites
 * you to configure something before you have decided whether you want it at all.
 */
export function SuggestionsForm({ current, people }: { current: SuggestionSettings; people: string[] }) {
  const router = useRouter();
  const [provider, setProvider] = useState<SuggestProvider>(current.provider);
  const [preset, setPreset] = useState(() => guessPreset(current.baseUrl));
  const [model, setModel] = useState(current.model);
  const [baseUrl, setBaseUrl] = useState(current.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [replacingKey, setReplacingKey] = useState(!current.apiKeySet);
  const [sendPeople, setSendPeople] = useState(current.sendPeople);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [tested, setTested] = useState<SuggestionTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const presetInfo = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === preset)!;

  function choose(id: SuggestProvider) {
    setProvider(id);
    setTested(null);
    setSaved(false);
  }

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
      sendPeople,
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
      setReplacingKey(false);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex max-w-[620px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <GroupLabel>Who reads your documents</GroupLabel>

        {PROVIDERS.map((p) => {
          const chosen = provider === p.id;
          return (
            <div
              key={p.id}
              className={chosen ? "rounded-md border-[1.5px] border-accent px-4 pt-3.5 pb-4" : "rounded-md border border-border px-4 py-3.5 hover:border-border-strong"}
            >
              <label className="flex cursor-pointer items-start gap-3">
                <input type="radio" name="provider" value={p.id} checked={chosen} onChange={() => choose(p.id)} className="sr-only" />
                <span className={`mt-0.5 size-4 shrink-0 rounded-pill ${chosen ? "border-[5px] border-accent" : "border-[1.5px] border-border-strong"}`} />
                <span className="flex flex-col gap-[3px]">
                  <span className="text-body font-semibold leading-[18px]">{p.label}</span>
                  <span className="text-small leading-[19px] text-muted">{p.note}</span>
                </span>
              </label>

              {chosen && p.id !== "none" && (
                <div className="mt-4 flex flex-col gap-3.5 border-t border-border pt-4 pl-7">
                  {p.id === "openai-compatible" && (
                    <div className="flex gap-4">
                      <Cell label="Endpoint" width="w-[240px]">
                        <select value={preset} onChange={(e) => applyPreset(e.target.value)} className={field}>
                          {OPENAI_COMPATIBLE_PRESETS.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.label}
                            </option>
                          ))}
                        </select>
                      </Cell>
                      <Cell label="Base URL">
                        <input
                          value={baseUrl}
                          onChange={(e) => {
                            setBaseUrl(e.target.value);
                            setTested(null);
                          }}
                          placeholder="https://openrouter.ai/api/v1"
                          spellCheck={false}
                          className={mono}
                        />
                      </Cell>
                    </div>
                  )}

                  <div className="flex gap-4">
                    <Cell label="Model" width="w-[240px]">
                      <input
                        value={model}
                        onChange={(e) => {
                          setModel(e.target.value);
                          setTested(null);
                        }}
                        placeholder={p.id === "anthropic" ? "claude-sonnet-5" : "anthropic/claude-sonnet-5"}
                        spellCheck={false}
                        className={mono}
                      />
                    </Cell>
                    <Cell label={`API key${p.id === "openai-compatible" && !presetInfo.needsKey ? " (optional here)" : ""}`}>
                      {current.apiKeySet && !replacingKey ? (
                        <div className={`${field} flex items-center justify-between`}>
                          <span className="font-mono text-small tracking-[0.16em] text-muted">••••••••••••••••</span>
                          <button type="button" onClick={() => setReplacingKey(true)} className="shrink-0 text-small font-medium text-accent">
                            Replace
                          </button>
                        </div>
                      ) : (
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => {
                            setApiKey(e.target.value);
                            setTested(null);
                          }}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="Paste the key"
                          className={mono}
                        />
                      )}
                    </Cell>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={test} disabled={busy !== null} className={secondary}>
                      {busy === "test" ? "Testing…" : "Test"}
                    </button>
                    {tested && (
                      <span className="flex items-center gap-[7px] text-small">
                        {tested.ok && (
                          <span className="flex size-[15px] shrink-0 items-center justify-center rounded-pill bg-accent-soft text-[10px] font-bold text-accent">✓</span>
                        )}
                        <span className={tested.ok ? "text-muted" : "text-danger"}>{tested.detail}</span>
                      </span>
                    )}
                  </div>

                  <p className="text-small leading-[19px] text-muted">
                    Stored encrypted under this vault&rsquo;s master key, the way mail passwords are. It is never sent back to
                    the browser, here or anywhere else.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {provider === "none" ? (
        <Note title="What leaves your house">
          Nothing. Titles come from the filename and the sender, dates from the text the vault reads itself, and no part of a
          document is sent anywhere. Suggestions are worse — that is the trade.
        </Note>
      ) : (
        <Note title="What leaves your house">
          For each document: the text on its pages, its filename, and the sender it arrived from. Your category names and the
          first names of the people in this vault, so the model can guess who a document is about — that part can be switched
          off below. Nothing else, and never the file itself.
          <label className="mt-3 flex cursor-pointer items-center gap-2.5 pt-0.5">
            <button
              type="button"
              role="switch"
              aria-checked={sendPeople}
              onClick={() => {
                setSendPeople(!sendPeople);
                setSaved(false);
              }}
              className={`flex h-5 w-[34px] shrink-0 items-center rounded-pill px-[3px] ${sendPeople ? "justify-end bg-accent" : "justify-start bg-border-strong"}`}
            >
              <span className="size-3.5 rounded-pill bg-ground" />
            </button>
            <span className="text-small text-text">{peopleLabel(people)}</span>
          </label>
        </Note>
      )}

      <div className="flex flex-wrap items-center gap-3.5 pt-1">
        <button type="button" onClick={save} disabled={busy !== null} className={primary}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <span className="text-small text-muted">
          {saved ? "Saved. Applies to the next document read." : "Applies to the next document read. Nothing already filed is touched."}
        </span>
        {error && <span className="text-small text-danger">{error}</span>}
      </div>
    </div>
  );
}

function Cell({ label, width, children }: { label: string; width?: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1.5 ${width ?? "grow basis-0"} ${width ? "shrink-0" : ""}`}>
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

/** "Send first names — Anna, Mara, Jonas", or the honest version when there is nobody yet. */
function peopleLabel(people: string[]): string {
  if (people.length === 0) return "Send first names — nobody is listed in this vault yet";
  const shown = people.slice(0, 3).join(", ");
  return `Send first names — ${shown}${people.length > 3 ? ` and ${people.length - 3} more` : ""}`;
}

function guessPreset(baseUrl: string | null): string {
  if (!baseUrl) return "openrouter";
  const match = OPENAI_COMPATIBLE_PRESETS.find((p) => p.baseUrl && baseUrl.startsWith(p.baseUrl));
  return match?.id ?? "custom";
}
