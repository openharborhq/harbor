"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SINK_CAPABILITIES, SINK_CONSEQUENCE, expiryOptionsFor, type ShareDeliverySettings } from "@harbor/shared";
import { useShareBasket } from "./ShareBasket";
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
 * The review step's body and footer, inside `ShareModal` (spec §10.5).
 *
 * The hierarchy is the design here, and it follows what the person is actually deciding. **Who
 * gets this** is the only real question — the documents were chosen on the page behind, and the
 * rest is a name and a duration. So the contents collapse to a line you can open, the share's own
 * fields are two controls, and recipients get the room.
 *
 * Three things it is obliged to say out loud, because each is a promise the vault cannot keep
 * quietly: a recipient's name is a label and not verified identity; what the chosen delivery
 * cannot do and why; and that copying the link is the send, because the box mails nothing. Each
 * sits next to the control it qualifies rather than in a paragraph nobody reads.
 */
export function ReviewShare({ onClose }: { onClose: () => void }) {
  const basket = useShareBasket();
  const [label, setLabel] = useState("");
  const [showFiles, setShowFiles] = useState(false);
  /**
   * Delivery is a setting, not a choice made here (§10.10). The step reads it so it can draw the
   * right controls and say what they mean — nobody sending four documents should be asked to pick
   * an architecture, least of all one that carries a setup requirement.
   */
  const [sink, setSink] = useState<ShareDeliverySettings | null>(null);
  const [expiryHours, setExpiryHours] = useState(168);
  const [recipients, setRecipients] = useState<Recipient[]>([{ label: "", password: "", limitOnce: false }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedLink[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const delivery = sink?.delivery ?? "doorman";
  const caps = SINK_CAPABILITIES[delivery];
  const options = expiryOptionsFor(delivery);
  const named = recipients.filter((r) => r.label.trim());

  useEffect(() => {
    api<ShareDeliverySettings>("/settings/share-delivery")
      .then((s) => {
        setSink(s);
        // Clamp to what this sink can actually keep, so the form never offers a dead link.
        const max = SINK_CAPABILITIES[s.delivery].maxExpiryHours;
        setExpiryHours((hours) => Math.min(hours, max));
      })
      .catch(() => setSink({ delivery: "doorman", ready: true, problem: null }));
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ id: string; links: CreatedLink[] }>("/shares", {
        method: "POST",
        body: JSON.stringify({
          label: label.trim() || `${basket.documents.length} documents`,
          documentIds: basket.documents.map((d) => d.id),
          expiryHours,
          recipients: named.map((r) => ({
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

  /* ---------------------------------------------------------------- *
   * After: the links, readable exactly once
   * ---------------------------------------------------------------- */
  if (created) {
    return (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <p className="text-body">
            {created.length === 1 ? "The link is" : `All ${created.length} links are`} ready. Copy{" "}
            {created.length === 1 ? "it" : "each one"} now — Harbor keeps them hashed and cannot show them again.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {created.map((link) => (
              <li key={link.linkId}>
                <div className="mb-1.5 text-row font-semibold">{link.recipientLabel}</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-3 py-2 font-mono text-small text-muted">
                    {link.url}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(link.url);
                      setCopied(link.linkId);
                    }}
                    className={`h-9 w-[84px] shrink-0 rounded-md text-row font-semibold transition-colors ${
                      copied === link.linkId ? "bg-accent-soft text-accent" : "bg-accent text-white hover:opacity-90"
                    }`}
                  >
                    {copied === link.linkId ? "Copied" : "Copy"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <Footer>
          <Link href="/shares" onClick={onClose} className="text-row text-accent hover:underline">
            See all shares
          </Link>
          <button type="button" onClick={onClose} className="ml-auto h-9 rounded-md bg-accent px-5 text-row font-semibold text-white hover:opacity-90">
            Done
          </button>
        </Footer>
      </>
    );
  }

  if (basket.ready && basket.documents.length === 0) {
    return (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 text-center">
          <p className="text-body text-muted">The basket is empty. Add documents from a search, an item, or the inbox.</p>
        </div>
        <Footer>
          <button type="button" onClick={onClose} className="ml-auto h-9 rounded-md border border-border px-4 text-row font-semibold">
            Close
          </button>
        </Footer>
      </>
    );
  }

  /* ---------------------------------------------------------------- *
   * Before: what is going, for how long, and to whom
   * ---------------------------------------------------------------- */
  const n = basket.documents.length;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/*
          The contents, as one line. They were chosen on the page behind this and are the least
          open question here; a full list at the top pushed the only real decision below the fold.
        */}
        <div className="border-b border-border px-6 py-3.5">
          <button
            type="button"
            onClick={() => setShowFiles((v) => !v)}
            aria-expanded={showFiles}
            className="flex w-full items-center gap-2.5 text-left"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-muted" aria-hidden="true">
              <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M12 3v12M8 7l4-4 4 4" />
            </svg>
            <span className="flex-1 text-row font-semibold">
              {n} document{n === 1 ? "" : "s"}
            </span>
            <span className="text-small text-muted">{showFiles ? "Hide" : "Show"}</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`size-3.5 shrink-0 text-muted transition-transform ${showFiles ? "rotate-180" : ""}`}
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {showFiles && (
            <>
              <ul className="mt-2 flex flex-col divide-y divide-border border-t border-border">
                {basket.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-small">{doc.title}</span>
                    <button
                      type="button"
                      onClick={() => basket.remove(doc.id)}
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-small text-muted transition-colors hover:text-danger"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-small text-muted">
                A snapshot: replacing one of these later will not change what the link hands out.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="min-w-0 flex-1">
              <label htmlFor="share-label" className="label mb-1.5 block">
                Name
              </label>
              <input
                id="share-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="2025 taxes for the Steuerberater"
                className="h-9 w-full rounded-md border border-border bg-ground px-3 text-row placeholder:text-muted/70"
              />
              <p className="mt-1.5 text-small text-muted">For your own list — recipients never see it.</p>
            </div>
            <div className="shrink-0">
              <label htmlFor="share-expiry" className="label mb-1.5 block">
                Available for
              </label>
              <select
                id="share-expiry"
                value={expiryHours}
                onChange={(e) => setExpiryHours(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-border bg-ground px-3 text-row sm:w-[130px]"
              >
                {options.map((o) => (
                  <option key={o.hours} value={o.hours}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-row font-semibold">Who it is for</h3>
              <span className="text-small text-muted">One link each</span>
            </div>
            <p className="mt-1 text-small text-muted">
              The name is your label — Harbor sends no mail, so it cannot check who is at the other end.
            </p>

            <ul className="mt-3 flex flex-col gap-2.5">
              {recipients.map((recipient, i) => (
                <li key={i} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={recipient.label}
                      onChange={(e) => setRecipients((prev) => prev.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
                      placeholder="Herr Brand, Steuerberater"
                      aria-label={`Recipient ${i + 1}`}
                      className="h-9 min-w-0 flex-1 rounded-md border border-border bg-ground px-3 text-row placeholder:text-muted/70"
                    />
                    {recipients.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRecipients((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={`Remove recipient ${i + 1}`}
                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-danger"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-4" aria-hidden="true">
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <input
                      value={recipient.password}
                      onChange={(e) => setRecipients((prev) => prev.map((r, j) => (j === i ? { ...r, password: e.target.value } : r)))}
                      placeholder="Password — optional, tell them by phone"
                      aria-label={`Password for recipient ${i + 1}`}
                      type="password"
                      autoComplete="off"
                      className="h-8 min-w-[200px] flex-1 rounded-md border border-border bg-ground px-2.5 text-small placeholder:text-muted/70"
                    />
                    {caps.maxDownloads && (
                      <label className="flex shrink-0 items-center gap-2 text-small text-muted">
                        <input
                          type="checkbox"
                          checked={recipient.limitOnce}
                          onChange={(e) => setRecipients((prev) => prev.map((r, j) => (j === i ? { ...r, limitOnce: e.target.checked } : r)))}
                        />
                        Once only
                      </label>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => setRecipients((prev) => [...prev, { label: "", password: "", limitOnce: false }])}
              className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-row font-semibold text-accent transition-colors hover:bg-accent-soft"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-3.5" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add another
            </button>
          </div>

          {/* What this delivery can and cannot promise, stated where it applies. */}
          <p className="border-t border-border pt-4 text-small text-muted">
            {SINK_CONSEQUENCE[delivery]}{" "}
            <Link href="/settings/sharing" onClick={onClose} className="text-accent hover:underline">
              Change
            </Link>
          </p>

          {sink && !sink.ready && <p className="rounded-md bg-warn-soft px-3 py-2 text-small text-warn">{sink.problem}</p>}
          {error && <p className="text-small text-danger">{error}</p>}
        </div>
      </div>

      <Footer>
        <span className="hidden text-small text-muted sm:block">Nothing is sent — you copy each link.</span>
        <button type="button" onClick={onClose} className="ml-auto h-9 rounded-md px-3 text-row font-semibold text-muted hover:text-text">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || named.length === 0 || (sink !== null && !sink.ready)}
          onClick={() => void submit()}
          className="h-9 rounded-md bg-accent px-5 text-row font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Sealing…" : named.length > 1 ? `Create ${named.length} links` : "Create link"}
        </button>
      </Footer>
    </>
  );
}

/** The band that does not scroll. Whatever the state, the way out of it is in the same place. */
function Footer({ children }: { children: React.ReactNode }) {
  return <footer className="flex shrink-0 items-center gap-3 border-t border-border px-6 py-3.5">{children}</footer>;
}
