"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BACKFILL_WINDOWS, backfillWindowLabel, type MailAutoconfigResult, type MailConnectionView } from "@harbor/shared";
import { api } from "@/lib/api-client";

const input = "h-10 w-full rounded-md border border-border-strong px-3 text-row";
const primary = "h-9 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-60";
const secondary = "h-9 rounded-md border border-border bg-ground px-4 text-row font-medium disabled:opacity-60";

/**
 * §7.3: the form asks for an address, then a password, and fills in the rest itself. The two
 * things it must get right are naming the provider's app-password page, and saying plainly when a
 * provider cannot be connected at all — an Outlook address fails at login otherwise, with an
 * error nobody can act on.
 */
export function ConnectForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<MailAutoconfigResult | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(993);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [state, setState] = useState<"idle" | "looking" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<string | null>(null);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setState("looking");
    setError(null);
    try {
      const result = await api<MailAutoconfigResult>(`/mail/autodiscover?email=${encodeURIComponent(email)}`);
      setFound(result);
      if (result.kind === "found") {
        setHost(result.host);
        setPort(result.port);
        setUsername(result.username);
        setLabel(email.split("@")[1] ?? email);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setState("idle");
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      await api<MailConnectionView>("/mail/connections", {
        method: "POST",
        body: JSON.stringify({
          label: label || email,
          emailAddress: email,
          imapHost: host,
          imapPort: port,
          imapUsername: username,
          password,
          scopeMode: "folder",
          folders: ["INBOX"],
          providerHint: found?.kind === "found" ? found.providerHint : null,
        }),
      });
      setConnected(email);
      setEmail("");
      setPassword("");
      setFound(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setState("idle");
    }
  }

  if (found?.kind === "unsupported") {
    return (
      <div className="flex max-w-[560px] flex-col gap-3">
        <p className="text-row font-medium">{found.reason}</p>
        <p className="text-body text-muted">{found.alternative}</p>
        <button type="button" onClick={() => setFound(null)} className={`${secondary} self-start`}>
          Try another address
        </button>
      </div>
    );
  }

  if (!found) {
    return (
      <div className="flex max-w-[560px] flex-col gap-3">
        {connected && (
          <p className="rounded-md bg-accent-soft px-3 py-2.5 text-small text-accent">
            {connected} is connected — it appears above. Checking the password now; nothing is filed until you approve a sender.
          </p>
        )}
        <form onSubmit={lookup} className="flex items-center gap-3">
          <input
            required
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setConnected(null);
            }}
            className={input}
          />
          <button type="submit" disabled={state === "looking" || !email} className={primary}>
            {state === "looking" ? "Looking…" : "Continue"}
          </button>
          {error && <span className="text-small text-danger">{error}</span>}
        </form>
      </div>
    );
  }

  return (
    <form onSubmit={create} className="flex max-w-[560px] flex-col gap-4">
      <p className="text-body text-muted">
        {found.kind === "found" && found.source !== "builtin"
          ? `Settings for ${email} came from ${found.source === "ispdb" ? "Mozilla's provider database" : "the domain's own DNS"}. Check them if anything looks wrong.`
          : `Settings for ${email} are filled in.`}
      </p>

      {found.kind === "found" && found.appPasswordNote && (
        <div className="rounded-md bg-surface px-3 py-2.5 text-small">
          {found.appPasswordNote}
          {found.appPasswordUrl && (
            <>
              {" "}
              <a href={found.appPasswordUrl} target="_blank" rel="noreferrer" className="font-medium text-accent underline underline-offset-2">
                Create one
              </a>
            </>
          )}
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-small text-muted">App password</span>
        <input required type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
      </label>

      <details className="text-small text-muted">
        <summary className="cursor-pointer">Server settings</summary>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span>Name</span>
            <input required value={label} onChange={(e) => setLabel(e.target.value)} className={input} />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5">
              <span>IMAP server</span>
              <input required value={host} onChange={(e) => setHost(e.target.value)} className={input} />
            </label>
            <label className="flex w-28 flex-col gap-1.5">
              <span>Port</span>
              <input required type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} className={input} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span>Username</span>
            <input required value={username} onChange={(e) => setUsername(e.target.value)} className={input} />
          </label>
        </div>
      </details>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "busy" || !password} className={primary}>
          {state === "busy" ? "Connecting…" : "Connect"}
        </button>
        <button type="button" onClick={() => setFound(null)} className={secondary}>
          Back
        </button>
        {error && <span className="text-small text-danger">{error}</span>}
      </div>
      <p className="text-small text-muted">
        The password is encrypted before it is stored and is never shown again. Connecting only tests it — nothing is filed
        until you approve a sender.
      </p>
    </form>
  );
}

/**
 * Test, scan, sync, remove. All four are queued for the fetcher rather than done here, so pressing
 * one starts something it cannot itself finish. What it does instead is watch the connection row
 * until that row answers — `lastCheckedAt` for a test or a sync, `backfillStartedAt` for a scan —
 * and only then stop saying it is working. Saying "Checking the connection…" until a refresh that
 * never comes was the old behaviour, and it outlasted the check by for ever.
 */
const POLL_MS = 2000;
/** Long enough for a slow IMAP handshake, short enough that a dead fetcher is not a mystery. */
const GIVE_UP_MS = 45000;

type Action = "test" | "backfill" | "sync";
type Pending = { action: Action; message: string; witness: string | null; startedAt: number };

/** The field on the row that moves when this action has been answered. */
function witnessOf(connection: MailConnectionView, action: Action): string | null {
  return action === "backfill" ? connection.backfillStartedAt : connection.lastCheckedAt;
}

export function ConnectionActions({ connection }: { connection: MailConnectionView }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [removing, setRemoving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const scanning = connection.backfillStartedAt !== null && connection.backfillCompletedAt === null;

  // Whether the answer has landed is a fact about the row we were just handed, so it is read here
  // rather than copied into state by an effect — there is only ever one source for it.
  const answered = pending !== null && witnessOf(connection, pending.action) !== pending.witness;
  const inFlight = pending !== null && !answered;
  const busy = inFlight || removing;
  const message = pending === null ? note : inFlight ? pending.message : pending.action === "backfill" ? null : "Checked just now";

  // Ask the server again until the row carries the answer.
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [inFlight, router]);

  // A confirmation is a fact about a moment and should not outlive the moment by much.
  useEffect(() => {
    if (!answered) return;
    const t = setTimeout(() => setPending(null), 5000);
    return () => clearTimeout(t);
  }, [answered]);

  // Nothing ever came back. Say that, rather than going on claiming to be busy.
  useEffect(() => {
    if (!inFlight) return;
    const t = setTimeout(() => {
      setPending(null);
      setNote("No answer came back — the mail fetcher may not be running.");
    }, GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [inFlight]);

  /**
   * Default to one stage deeper than the last completed scan (§7.6). Reading two months, muting
   * the senders that turn out to be noise, then reading six is how a mailbox of a few hundred
   * thousand messages stays a queue rather than becoming a pile — each pass is smaller than the
   * last because the mutes carry forward.
   */
  const [months, setMonths] = useState<number>(() => {
    const done = connection.backfillMonths;
    if (!done) return BACKFILL_WINDOWS[0];
    return BACKFILL_WINDOWS.find((w) => w > done) ?? done;
  });

  async function run(action: Action, message: string) {
    setNote(null);
    const witness = witnessOf(connection, action);
    setPending({ action, message, witness, startedAt: Date.now() });
    try {
      await api(`/mail/connections/${connection.id}/${action}`, {
        method: "POST",
        body: action === "backfill" ? JSON.stringify({ months }) : undefined,
      });
      router.refresh();
    } catch (err) {
      setPending(null);
      setNote((err as Error).message);
    }
  }

  async function remove() {
    if (!confirm(`Disconnect ${connection.emailAddress}? Documents already filed stay in the vault; nothing is removed from the mailbox.`)) return;
    setRemoving(true);
    try {
      await api(`/mail/connections/${connection.id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setNote((err as Error).message);
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <button type="button" disabled={busy} onClick={() => run("test", "Checking the connection…")} className={secondary}>
        Test
      </button>
      <span className="inline-flex items-center gap-1.5">
        <select
          value={months}
          disabled={busy || scanning}
          onChange={(e) => setMonths(Number(e.target.value))}
          aria-label="How far back to scan"
          className="h-9 rounded-md border border-border bg-ground px-2 text-row font-medium disabled:opacity-60"
        >
          {BACKFILL_WINDOWS.map((w) => (
            <option key={w} value={w}>
              {backfillWindowLabel(w)}
            </option>
          ))}
        </select>
        <button type="button" disabled={busy || scanning} onClick={() => run("backfill", `Scanning the last ${backfillWindowLabel(months)}…`)} className={secondary}>
          Scan
        </button>
      </span>
      <button type="button" disabled={busy} onClick={() => run("sync", "Checking for new mail…")} className={secondary}>
        Check now
      </button>
      <button type="button" disabled={busy} onClick={remove} className="h-9 rounded-md px-3 text-row font-medium text-danger">
        Disconnect
      </button>
      <span aria-live="polite" className="text-small text-muted">
        {message}
      </span>
    </div>
  );
}
