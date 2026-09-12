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

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex h-9 shrink-0 items-center gap-2 rounded-md bg-accent px-4 text-row font-medium text-white hover:opacity-90">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add a to-do
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-3 rounded-card border border-border p-4">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What has to happen?"
        maxLength={120}
        className="h-9 rounded-md border border-border-strong px-3 text-body outline-none focus:border-accent"
      />
      <div className="flex items-center gap-2">
        <span className="w-[92px] shrink-0 label">Document</span>
        <div className="min-w-0 flex-1">
          <DocumentPicker value={doc} onChange={setDoc} placeholder="Which document is this about? (optional)" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as TaskKind)} className="h-9 rounded-md border border-border-strong px-2 text-row">
          {TaskKind.options.map((k) => (
            <option key={k} value={k}>
              {TASK_KIND_VERB[k]}
            </option>
          ))}
        </select>
        <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="h-9 rounded-md border border-border-strong px-2 text-row" />
        <div className="flex items-center gap-1">
          <CurrencySelect value={currency} onChange={setCurrency} />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="Amount"
            className="h-9 w-28 rounded-md border border-border-strong px-3 text-row"
          />
        </div>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="h-9 max-w-[220px] rounded-md border border-border-strong px-2 text-row">
          <option value="">Not about anything in particular</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-md px-3 text-row text-muted hover:text-text">
          Cancel
        </button>
        <button type="submit" disabled={busy || !title.trim()} className="h-9 rounded-md bg-accent px-4 text-row font-medium text-white disabled:opacity-50">
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <div className="text-small text-danger">{error}</div>}
    </form>
  );
}
