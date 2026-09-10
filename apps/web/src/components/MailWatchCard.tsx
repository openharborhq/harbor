"use client";

import { useEffect, useState } from "react";
import { syncIntervalLabel, type MailConnectionView } from "@harbor/shared";

/**
 * What an empty Inbox should say when a mailbox is connected.
 *
 * The old copy — "gmail.com is being watched. Harbor checks every few minutes" — was vague in
 * every place a precise fact was already in hand. This says which mailbox, how often, and when it
 * last happened, because the whole claim of email-in is that something is working while you are
 * not looking, and a vague claim is indistinguishable from a broken one.
 */
export function MailWatchCard({ connections }: { connections: MailConnectionView[] }) {
  if (connections.length === 0) return null;
  return (
    <div className="mx-auto flex max-w-[440px] flex-col gap-3">
      {connections.map((c) => (
        <Watched key={c.id} connection={c} />
      ))}
    </div>
  );
}

function Watched({ connection }: { connection: MailConnectionView }) {
  const provider = describeProvider(connection);
  return (
    <div className="flex items-start gap-3 rounded-card border border-border bg-ground p-4 text-left">
      <ProviderMark provider={provider.key} />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold">{provider.name} is connected.</p>
        <p className="mt-0.5 text-body text-muted">
          Watching <span className="font-medium text-text">{connection.label}</span> {syncIntervalLabel(connection.syncIntervalSeconds)}.
        </p>
        <LastChecked at={connection.lastCheckedAt} />
      </div>
    </div>
  );
}

/**
 * Relative, and it keeps up. This is a page people leave open — a card that froze at "just now"
 * would be making the same vague promise the old copy did, only with more confidence.
 */
function LastChecked({ at }: { at: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!at) return <p className="mt-1 text-small text-muted">No sweep has finished yet — the first one runs shortly after startup.</p>;
  return (
    <p className="mt-1 text-small text-muted">
      Last checked <span title={new Date(at).toLocaleString()}>{ago(at)}</span>.
    </p>
  );
}

function ago(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * Named from `providerHint`, never assumed to be Gmail. The same card has to read correctly for
 * Fastmail, iCloud and a bare IMAP host on someone's own server.
 */
function describeProvider(c: MailConnectionView): { key: string; name: string } {
  const hint = (c.providerHint ?? "").toLowerCase();
  const domain = c.emailAddress.split("@")[1]?.toLowerCase() ?? "";
  const source = `${hint} ${domain}`;
  if (/gmail|google/.test(source)) return { key: "gmail", name: "Gmail" };
  if (/fastmail/.test(source)) return { key: "fastmail", name: "Fastmail" };
  if (/icloud|apple|me\.com/.test(source)) return { key: "icloud", name: "iCloud Mail" };
  if (/proton/.test(source)) return { key: "proton", name: "Proton Mail" };
  if (/yahoo/.test(source)) return { key: "yahoo", name: "Yahoo Mail" };
  return { key: "imap", name: "Your mailbox" };
}

/**
 * A mark, not a logo. Drawing someone else's wordmark into the product would be a trademark
 * question nobody needs; the envelope tinted to the provider's colour says which service it is
 * without borrowing anything.
 */
function ProviderMark({ provider }: { provider: string }) {
  const colour =
    provider === "gmail"
      ? "#C5221F"
      : provider === "fastmail"
        ? "#0067B9"
        : provider === "icloud"
          ? "#3B82F6"
          : provider === "proton"
            ? "#6D4AFF"
            : provider === "yahoo"
              ? "#6001D2"
              : "var(--color-muted)";
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface" aria-hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={colour} strokeWidth="1.8" strokeLinejoin="round">
        <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
        <path d="m3 7 9 6.5L21 7" strokeLinecap="round" />
      </svg>
    </span>
  );
}
