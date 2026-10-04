"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TASK_KIND_VERB, TaskKind, normaliseCurrency, type Currency, type Item } from "@harbor/shared";
import { api } from "@/lib/api-client";
import { CurrencySelect } from "@/components/CurrencySelect";
import { DocumentPicker } from "@/components/DocumentPicker";

/** The last currency typed into this form, per browser. A household that pays in dollars should not correct "€" every time. */
const LAST_CURRENCY_KEY = "harbor.lastCurrency";

function rememberedCurrency(): Currency {
  try {
    return normaliseCurrency(window.localStorage.getItem(LAST_CURRENCY_KEY)) ?? "EUR";
  } catch {
    return "EUR";
  }
}

/**
 * A to-do that came from nobody's paperwork — "ask the Hausverwaltung about the meter reading".
 * Everything except the title is optional, because a to-do you have to fill a form out for is one
 * you write on paper instead.
 */
export function AddTask({ items }: { items: Item[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskKind>("review");
  const [dueOn, setDueOn] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency | null>(rememberedCurrency);
  const [itemId, setItemId] = useState("");
  const [doc, setDoc] = useState<{ id: string; title: string; categoryPath: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // Typed as "248.10"; stored in minor units, so no float ever reaches the database.
      const cents = amount.trim() ? Math.round(Number(amount.replace(",", ".")) * 100) : null;
      if (cents !== null && !Number.isFinite(cents)) throw new Error("That amount isn't a number.");
      await api("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          kind,
          dueOn: dueOn || null,
          amountCents: cents,
          currency: cents === null ? null : currency,
          itemId: itemId || null,
          documentId: doc?.id ?? null,
        }),
      });
      if (cents !== null && currency) {
        try {
          window.localStorage.setItem(LAST_CURRENCY_KEY, currency);
        } catch {
          // A browser that refuses storage just asks again next time.
        }
      }
      setTitle("");
      setDueOn("");
      setAmount("");
      setItemId("");
      setDoc(null);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /*
   * Below lg the TopBar's round "+" is already the screen's cobalt, and it adds documents, not
   * to-dos. So on a phone this is a quiet full-width outline under the totals, 48px tall; from lg
   * it is the filled button beside the title it always was.
   */
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-border-strong bg-ground text-copy font-semibold text-text hover:border-accent hover:text-accent lg:h-9 lg:w-auto lg:shrink-0 lg:justify-start lg:border-0 lg:bg-accent-fill lg:px-4 lg:text-row lg:font-medium lg:text-white lg:hover:text-white lg:hover:opacity-90"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-[18px] w-[18px] lg:h-3.5 lg:w-3.5">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add a to-do
      </button>
    );
  }

  return (
    // Every control is 44px below lg and the desktop's 36px from it; the picker is shared, so its
    // field is raised from here rather than inside it.
    <form onSubmit={submit} className="flex w-full flex-col gap-3 rounded-card border border-border p-4">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What has to happen?"
        maxLength={120}
        className="h-11 rounded-md border border-border-strong px-3 text-body outline-none focus:border-accent lg:h-9"
      />
      <div className="flex items-center gap-2">
        <span className="hidden w-[92px] shrink-0 label lg:block">Document</span>
        <div className="min-w-0 flex-1 [&_input]:h-11 lg:[&_input]:h-9">
          <DocumentPicker value={doc} onChange={setDoc} placeholder="Which document is this about? (optional)" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as TaskKind)} className="h-11 rounded-md border border-border-strong px-2 text-body lg:h-9 lg:text-row">
          {TaskKind.options.map((k) => (
            <option key={k} value={k}>
              {TASK_KIND_VERB[k]}
            </option>
          ))}
        </select>
        <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} aria-label="Due on" className="h-11 rounded-md border border-border-strong px-2 text-body lg:h-9 lg:text-row" />
        <div className="flex items-center gap-1">
          <CurrencySelect value={currency} onChange={setCurrency} className="h-11 text-body lg:h-9 lg:text-row" />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="Amount"
            className="h-11 w-28 rounded-md border border-border-strong px-3 text-body lg:h-9 lg:text-row"
          />
        </div>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="h-11 w-full rounded-md border border-border-strong px-2 text-body lg:h-9 lg:w-auto lg:max-w-[220px] lg:text-row">
          <option value="">Not about anything in particular</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-md px-3 text-body text-muted hover:text-text lg:h-9 lg:text-row">
          Cancel
        </button>
        <button type="submit" disabled={busy || !title.trim()} className="h-11 rounded-md bg-accent-fill px-5 text-copy font-semibold text-white disabled:opacity-50 lg:h-9 lg:px-4 lg:text-row lg:font-medium">
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <div className="text-body text-danger lg:text-small">{error}</div>}
    </form>
  );
}
