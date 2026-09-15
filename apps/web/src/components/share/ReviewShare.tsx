"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SINK_CAPABILITIES, expiryOptionsFor, type ShareDeliverySettings } from "@harbor/shared";
import { useShareBasket, type BasketDocument } from "./ShareBasket";
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
 * The explanatory text is gone, at Kai's direction (2026-09-14): what the name is for, that the
 * list is a snapshot, that a row can be clicked, what the delivery cannot promise, and that a
 * recipient's name is a label rather than verified identity. §10.4 asked for that last one to be
 * said here; the spec now records that it is not, and why. The structure carries what it can — one
 * link per recipient is visible in the list, and a control a sink cannot support is simply absent.
 */
export function ReviewShare({
  onClose,
  preview,
  onPreview,
}: {
  onClose: () => void;
  preview: BasketDocument | null;
  onPreview: (doc: BasketDocument | null) => void;
}) {
  const basket = useShareBasket();
  const [label, setLabel] = useState("");
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
      // Unreachable settings should not stop a share being reviewed. Assumed published, so the
      // fallback does not accuse a working install of a problem it cannot check.
      .catch(() => setSink({ delivery: "doorman", ready: true, problem: null, doormanPublished: true, doormanOrigin: "" }));
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
      // The documents come off every list the moment the share exists: leaving them ticked invites
      // a second share of the same paperwork to someone else by accident.
      basket.clear();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Finishing with the links drops them.
   *
   * They are bearer credentials — anyone holding one can fetch the documents — and they exist in
   * readable form in exactly two places: the recipient's hands and this component's state. Closing
   * unmounts it anyway, but a dialog left open in a background tab should not be the third place,
   * so they are cleared on the way out rather than as a side effect of React tearing down.
   */
  function done() {
    setCreated(null);
    setCopied(null);
    onClose();
  }

  /* ---------------------------------------------------------------- *
   * After: the links, readable exactly once
   * ---------------------------------------------------------------- */
  if (created) {
    return (
      <>
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
                      copied === link.linkId ? "bg-accent-soft text-accent" : "bg-accent-fill text-white hover:opacity-90"
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
          <Link href="/shares" onClick={done} className="text-row text-accent hover:underline">
            See all shares
          </Link>
          <button type="button" onClick={done} className="ml-auto h-9 rounded-md bg-accent-fill px-5 text-row font-semibold text-white hover:opacity-90">
            Done
          </button>
        </Footer>
      </>
    );
  }

  if (basket.ready && basket.documents.length === 0) {
    return (
      <>
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-6 py-8 text-center">
          <p className="text-body text-muted">Nothing selected. Tick documents in any list — a search, an item, the inbox — to share them.</p>
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
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
        {/*
          Name and duration first: they describe the share itself, and answering them before
          scrolling a list is the order someone actually thinks in.
        */}
        <div className="border-b border-border px-6 py-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="min-w-0 flex-1">
              <label htmlFor="share-label" className="label mb-1.5 block">
                Name
              </label>
              <input
                id="share-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="2025 tax documents"
                className="h-9 w-full rounded-md border border-border bg-ground px-3 text-row placeholder:text-muted/70"
              />
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
        </div>

        {/*
          A fixed-height list, not a growing one. Two documents or twenty, the fields below start
          in the same place and the footer never moves — and the rows scroll in their own box
          rather than pushing the form down.
        */}
        <div className="border-b border-border px-6 py-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="text-row font-semibold">
              {n} document{n === 1 ? "" : "s"}
            </h3>
            {/*
              Starting over without unticking a dozen boxes one at a time. No confirmation: it
              clears a selection, not anything of yours — and the documents are all still a tick
              away on the page behind.
            */}
            <button
              type="button"
              onClick={basket.clear}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-small text-muted transition-colors hover:text-danger"
            >
              Clear all
            </button>
          </div>
          {/*
            Ten rows, then it scrolls. A fixed height showed four of them and wasted the rest of a
            tall dialog on a share of two; growing without a ceiling would push the recipients —
            the only real question here — off the bottom on a share of thirty.
          */}
          <ul className="scrollbar-none max-h-[360px] overflow-y-auto rounded-lg border border-border">
            {basket.documents.map((doc) => {
              const active = preview?.id === doc.id;
              return (
                <li key={doc.id} className={`flex items-center gap-2.5 border-b border-border px-2.5 py-2 last:border-b-0 ${active ? "bg-accent-soft" : ""}`}>
                  <button
                    type="button"
                    onClick={() => onPreview(doc)}
                    aria-pressed={active}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`size-[18px] shrink-0 ${active ? "text-accent" : "text-muted"}`}
                      aria-hidden="true"
                    >
                      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
                      <path d="M14 3v5h5M9 13h6M9 17h4" />
                    </svg>
                    <span className={`min-w-0 flex-1 truncate text-small ${active ? "font-semibold text-accent" : ""}`}>{doc.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => basket.remove(doc.id)}
                    aria-label={`Remove ${doc.title} from this share`}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-ground hover:text-danger"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-3.5" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-6 py-5">
          <div>
            <h3 className="text-row font-semibold">Recipients</h3>

            <ul className="mt-3 flex flex-col gap-2.5">
              {recipients.map((recipient, i) => (
                <li key={i} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={recipient.label}
                      onChange={(e) => setRecipients((prev) => prev.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
                      placeholder="Accountant"
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
                      placeholder="Password (optional)"
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
                        {/*
                          Named for what it limits. "Once only", sitting beside a password field,
                          read as if the password were single-use — it is the finished download
                          that is counted, and opening the link costs nothing.
                        */}
                        One download only
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

          {sink && !sink.ready && <p className="rounded-md bg-warn-soft px-3 py-2 text-small text-warn">{sink.problem}</p>}
          {/*
            Said here and not only in Settings: this is the screen where a link is about to be
            handed to somebody, and a link that reaches nobody is worth knowing about before it is
            sent rather than after. It warns rather than blocks — the bundle and the link are both
            real, and `harbor public enable` makes them reachable without invalidating either.
          */}
          {sink && sink.delivery === "doorman" && !sink.doormanPublished && (
            <p className="rounded-md bg-warn-soft px-3 py-2 text-small text-warn">
              These links will not reach anyone outside this box until <code className="font-mono">harbor public enable</code> has been
              run on it. Links made now start working when it is.
            </p>
          )}
          {error && <p className="text-small text-danger">{error}</p>}
        </div>
      </div>

      <Footer>
        <button type="button" onClick={onClose} className="ml-auto h-9 rounded-md px-3 text-row font-semibold text-muted hover:text-text">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || named.length === 0 || (sink !== null && !sink.ready)}
          onClick={() => void submit()}
          className="h-9 rounded-md bg-accent-fill px-5 text-row font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
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
