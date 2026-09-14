"use client";

import Link from "next/link";
import { useState } from "react";
import { SINK_CAPABILITIES, SINK_CONSEQUENCE, expiryOptionsFor, type ShareDelivery } from "@harbor/shared";
import { useShareBasket } from "@/components/share/ShareBasket";
import { api } from "@/lib/api-client";

interface Recipient {
  label: string;
  password: string;
  limitOnce: boolean;
}

interface CreatedLink {
  linkId: string;
  recipientLabel: string;
  url: string;
}

/**
 * The review screen (spec §10.5): the last place a share is still editable, and the only place
 * its links are ever readable.
 *
 * Three things it is obliged to say out loud, because each is a promise the vault cannot keep
 * quietly: a recipient's name is a label and not verified identity; what a sink cannot do and
 * why; and that copying the link is the send, because the box mails nothing.
 */
export function ReviewShare() {
  const basket = useShareBasket();
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  const [delivery, setDelivery] = useState<ShareDelivery>("doorman");
  const [expiryHours, setExpiryHours] = useState(168);
  const [recipients, setRecipients] = useState<Recipient[]>([{ label: "", password: "", limitOnce: false }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedLink[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const caps = SINK_CAPABILITIES[delivery];
  const options = expiryOptionsFor(delivery);

  function setDeliveryAndClamp(next: ShareDelivery) {
    setDelivery(next);
    const max = SINK_CAPABILITIES[next].maxExpiryHours;
    if (expiryHours > max) setExpiryHours(max);
    if (!SINK_CAPABILITIES[next].maxDownloads) setRecipients((prev) => prev.map((r) => ({ ...r, limitOnce: false })));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ id: string; links: CreatedLink[] }>("/shares", {
        method: "POST",
        body: JSON.stringify({
          label: label.trim() || `${basket.documents.length} documents`,
          message: message.trim() || undefined,
          documentIds: basket.documents.map((d) => d.id),
          delivery,
          expiryHours,
          recipients: recipients
            .filter((r) => r.label.trim())
            .map((r) => ({
              label: r.label.trim(),
              password: r.password.trim() || undefined,
              maxDownloads: r.limitOnce ? 1 : undefined,
            })),
        }),
      });
      setCreated(result.links);
      basket.clear();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="flex flex-col gap-5">
        <div className="rounded-card border border-border bg-ground p-6">
          <h2 className="text-section font-semibold tracking-snug">Copy each link now</h2>
          <p className="mt-1 max-w-[62ch] text-body text-muted">
            These are shown once. Harbor stores them hashed, the way it stores sessions, so there is no way to read them
            again later — and the box sends no mail, so passing them on is yours to do.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {created.map((link) => (
              <li key={link.linkId} className="rounded-lg border border-border bg-surface p-3">
                <div className="text-row font-semibold">{link.recipientLabel}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-sm border border-border bg-ground px-2 py-1.5 font-mono text-small">
                    {link.url}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(link.url);
                      setCopied(link.linkId);
                    }}
                    className="h-8 shrink-0 rounded-md bg-accent px-3 text-row font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    {copied === link.linkId ? "Copied" : "Copy"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Link href="/shares" className="inline-flex h-9 items-center rounded-md border border-border bg-ground px-4 text-row font-semibold">
            Done
          </Link>
        </div>
      </div>
    );
  }

  if (basket.ready && basket.documents.length === 0) {
    return (
      <div className="rounded-card border border-border bg-ground p-8 text-center">
        <h2 className="text-section font-semibold tracking-snug">Nothing in the basket</h2>
        <p className="mx-auto mt-2 max-w-[52ch] text-body text-muted">
          Add documents from anywhere they are listed — a search, an item, the inbox — and they gather here.
        </p>
        <Link href="/library" className="mt-5 inline-flex h-9 items-center rounded-md bg-accent px-4 text-row font-semibold text-white">
          Find documents
        </Link>
      </div>
    );
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-5">
      <section className="rounded-card border border-border bg-ground p-5">
        <h2 className="text-section font-semibold tracking-snug">
          {basket.documents.length} document{basket.documents.length === 1 ? "" : "s"}
        </h2>
        <ul className="mt-3 flex flex-col divide-y divide-border">
          {basket.documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-row">{doc.title}</span>
              <button
                type="button"
                onClick={() => basket.remove(doc.id)}
                className="h-7 shrink-0 rounded-md px-2 text-small text-muted transition-colors hover:bg-surface hover:text-danger"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-small text-muted">
          A share is a snapshot. Replacing one of these documents later will not change what the link hands out.
        </p>
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-border bg-ground p-5">
        <div>
          <label htmlFor="share-label" className="label mb-1.5 block">
            What is this
          </label>
          <input
            id="share-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="2025 taxes for the Steuerberater"
            className="h-9 w-full rounded-md border border-border bg-ground px-3 text-row"
          />
          <p className="mt-1.5 text-small text-muted">For your own list. Recipients never see it.</p>
        </div>

        <div>
          <label htmlFor="share-message" className="label mb-1.5 block">
            Note on the page <span className="font-normal normal-case tracking-normal text-muted">(optional)</span>
          </label>
          <input
            id="share-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="The three invoices you asked for."
            className="h-9 w-full rounded-md border border-border bg-ground px-3 text-row"
          />
        </div>

        <fieldset>
          <legend className="label mb-1.5">How it is served</legend>
          <div className="flex flex-col gap-2">
            {(["doorman", "bucket"] as ShareDelivery[]).map((option) => (
              <label
                key={option}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
                  delivery === option ? "border-accent bg-accent-soft" : "border-border"
                }`}
              >
                <input
                  type="radio"
                  name="delivery"
                  checked={delivery === option}
                  onChange={() => setDeliveryAndClamp(option)}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="block text-row font-semibold">{option === "doorman" ? "By Harbor" : "From your own storage"}</span>
                  <span className="block text-small text-muted">{SINK_CONSEQUENCE[option]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="share-expiry" className="label mb-1.5 block">
            Available for
          </label>
          <select
            id="share-expiry"
            value={expiryHours}
            onChange={(e) => setExpiryHours(Number(e.target.value))}
            className="h-9 rounded-md border border-border bg-ground px-3 text-row"
          >
            {options.map((o) => (
              <option key={o.hours} value={o.hours}>
                {o.label}
              </option>
            ))}
          </select>
          {caps.maxExpiryHours < 720 && (
            <p className="mt-1.5 text-small text-muted">
              Links from your own storage last at most 7 days — that is the longest a signed URL can be valid. Serve it by
              Harbor for longer.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-card border border-border bg-ground p-5">
        <h2 className="text-section font-semibold tracking-snug">Who it is for</h2>
        <p className="mt-1 max-w-[62ch] text-small text-muted">
          One link each, so you can see who opened it and withdraw one without breaking the other. The name is a label you
          chose — Harbor sends no mail, so it cannot check who is at the other end.
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {recipients.map((recipient, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex gap-2">
                <input
                  value={recipient.label}
                  onChange={(e) => setRecipients((prev) => prev.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
                  placeholder="Herr Brand, Steuerberater"
                  aria-label="Recipient"
                  className="h-9 min-w-0 flex-1 rounded-md border border-border bg-ground px-3 text-row"
                />
                {recipients.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRecipients((prev) => prev.filter((_, j) => j !== i))}
                    className="h-9 shrink-0 rounded-md px-2 text-small text-muted hover:text-danger"
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                value={recipient.password}
                onChange={(e) => setRecipients((prev) => prev.map((r, j) => (j === i ? { ...r, password: e.target.value } : r)))}
                placeholder="Password (optional) — tell them by phone"
                aria-label="Password"
                autoComplete="off"
                className="h-9 w-full rounded-md border border-border bg-ground px-3 text-row"
              />
              {caps.maxDownloads ? (
                <label className="flex items-center gap-2 text-small text-muted">
                  <input
                    type="checkbox"
                    checked={recipient.limitOnce}
                    onChange={(e) => setRecipients((prev) => prev.map((r, j) => (j === i ? { ...r, limitOnce: e.target.checked } : r)))}
                  />
                  Allow one download only
                </label>
              ) : (
                <p className="text-small text-muted">
                  A one-download limit needs Harbor to serve the link — counting downloads is something your storage cannot do.
                </p>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setRecipients((prev) => [...prev, { label: "", password: "", limitOnce: false }])}
          className="mt-3 h-8 rounded-md border border-border px-3 text-row font-semibold text-muted hover:text-text"
        >
          Add another recipient
        </button>
      </section>

      {error && <p className="text-body text-danger">{error}</p>}

      <div className="flex items-center gap-3 pb-24">
        <button
          type="button"
          disabled={busy || !recipients.some((r) => r.label.trim())}
          onClick={() => void submit()}
          className="inline-flex h-10 items-center rounded-md bg-accent px-5 text-body font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Sealing…" : "Create links"}
        </button>
        <span className="text-small text-muted">Nothing is sent. You copy each link yourself.</span>
      </div>
    </div>
  );
}
