"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { dueSentence, formatAmount, normaliseCurrency, shortDate, type Currency, type Task } from "@harbor/shared";
import { CurrencySelect } from "./CurrencySelect";
import { api } from "@/lib/api-client";

const TONE = { danger: "text-danger", warn: "text-warn", plain: "text-text", muted: "text-muted" } as const;

/**
 * What this document says still has to be done, on the document itself (spec §8).
 *
 * It sits above the summary because if you opened this page from the To do list, the to-do is why
 * you are here. Settled ones stay visible underneath — "July's bill was paid by Dina on 4 Aug" is
 * the context that tells you whether this month's is really outstanding.
 */
export function DocumentTasks({ documentId, tasks, variant = "panel" }: { documentId: string; tasks: Task[]; variant?: "panel" | "sheet" }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");

  const open = tasks.filter((t) => t.status === "open");
  const settled = tasks.filter((t) => t.status !== "open");

  async function close(task: Task) {
    setBusy(task.id);
    setError(null);
    try {
      await api(`/tasks/${task.id}/close`, { method: "POST", body: JSON.stringify({ status: "done", reason: null }) });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Correct what the model read off the page.
   *
   * A tax form carries half a dozen amounts — subtotals, a prior balance, the tax itself — and the
   * one that matters is whichever line says what you owe. The model picks well but not always, and
   * a reminder carrying the wrong number is worse than one carrying none, so the correction lives
   * here beside the document rather than behind a trip to another page.
   */
  async function saveEdit(task: Task, patch: { title: string; amount: string; currency: Currency | null; dueOn: string }) {
    setBusy(task.id);
    setError(null);
    try {
      const trimmed = patch.amount.trim().replace(/[^0-9.,-]/g, "").replace(",", ".");
      const cents = trimmed ? Math.round(Number(trimmed) * 100) : null;
      if (cents !== null && !Number.isFinite(cents)) throw new Error("That amount isn't a number.");
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: patch.title.trim() || task.title,
          amountCents: cents,
          currency: cents === null ? null : patch.currency,
          dueOn: patch.dueOn || null,
        }),
      });
      setEditing(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy("new");
    setError(null);
    try {
      await api("/tasks", { method: "POST", body: JSON.stringify({ title: title.trim(), dueOn: dueOn || null, documentId }) });
      setTitle("");
      setDueOn("");
      setAdding(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** The new-to-do form, shared by both layouts so the handler is one. */
  function addForm() {
    return (
      <form onSubmit={add} className="flex flex-col gap-2 border-t border-border p-3">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What has to happen?"
          maxLength={120}
          className="h-11 rounded-md border border-border-strong px-3 text-body outline-none focus:border-accent lg:h-9 lg:text-row"
        />
        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
          <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="h-11 rounded-md border border-border-strong px-2 text-body lg:h-9 lg:text-small" />
          <div className="flex-1" />
          <button type="button" onClick={() => setAdding(false)} className="h-11 px-2 text-body text-muted lg:h-9 lg:text-small">
            Cancel
          </button>
          <button type="submit" disabled={busy === "new" || !title.trim()} className="h-11 rounded-md bg-accent-fill px-4 text-body font-semibold text-white disabled:opacity-50 lg:h-9 lg:px-3 lg:text-small lg:font-medium">
            Add
          </button>
        </div>
      </form>
    );
  }

  /*
   * On a phone, in the sheet over the page: one tinted card per open to-do, the tick the size of a
   * thumb and the title at reading size. The panel's second line of "Edit" and "Mark paid" is gone
   * because the tick already marks it done; "Edit" stays, as a word at the end of the row, because
   * correcting what the model read is the other thing this list is for.
   */
  if (variant === "sheet") {
    return (
      <section className="flex flex-col gap-2.5">
        {open.map((t) => {
          if (editing === t.id) {
            return (
              <div key={t.id} className="rounded-lg bg-surface">
                <EditTask task={t} busy={busy === t.id} onCancel={() => setEditing(null)} onSave={(patch) => saveEdit(t, patch)} />
              </div>
            );
          }
          const due = dueSentence(t.dueOn);
          const amount = formatAmount(t.amountCents, t.currency);
          return (
            <div key={t.id} className="flex items-center gap-3.5 rounded-lg bg-surface py-3.5 pl-4 pr-2">
              {/* 26px to look at, 44px to hit. */}
              <button
                type="button"
                onClick={() => close(t)}
                disabled={busy === t.id}
                aria-label={`Mark "${t.title}" ${t.kind === "pay" ? "paid" : "done"}`}
                className="-m-[9px] flex size-11 shrink-0 items-center justify-center disabled:opacity-50"
              >
                <span className="size-[26px] rounded-pill border-2 border-border-strong bg-ground" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-copy font-semibold">{t.title}</div>
                <div className="mt-0.5 text-body text-muted">
                  {amount && `${amount} · `}
                  <span className={due.tone === "danger" || due.tone === "warn" ? TONE[due.tone] : ""}>{due.text}</span>
                </div>
              </div>
              <button type="button" onClick={() => setEditing(t.id)} className="h-11 shrink-0 px-2 text-body font-medium text-muted">
                Edit
              </button>
            </div>
          );
        })}
        {settled.map((t) => (
          <p key={t.id} className="text-body text-muted">
            {t.title} — {t.status === "done" ? "done" : "dismissed"}
            {t.closedBy ? ` by ${t.closedBy}` : ""}
            {t.closedAt ? ` on ${shortDate(t.closedAt.slice(0, 10))}` : ""}
          </p>
        ))}
        {adding ? (
          <div className="overflow-hidden rounded-lg border border-border-strong [&>form]:border-t-0">{addForm()}</div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="flex h-11 items-center self-start text-body font-medium text-accent">
            {open.length || settled.length ? "+ Add another to-do" : "+ Add a to-do"}
          </button>
        )}
        {error && <p className="text-body text-danger">{error}</p>}
      </section>
    );
  }

  if (open.length === 0 && settled.length === 0 && !adding) {
    return (
      <button type="button" onClick={() => setAdding(true)} className="mt-6 self-start text-row font-medium text-accent">
        + Add a to-do for this document
      </button>
    );
  }

  return (
    <section className="mt-6 flex flex-col overflow-hidden rounded-lg border border-border-strong">
      {open.map((t) => {
        const due = dueSentence(t.dueOn);
        const amount = formatAmount(t.amountCents, t.currency);
        if (editing === t.id) {
          return <EditTask key={t.id} task={t} busy={busy === t.id} onCancel={() => setEditing(null)} onSave={(patch) => saveEdit(t, patch)} />;
        }
        return (
          /*
           * Three lines, not one. This panel is 420px wide and the row was carrying a title, an
           * amount, a relative date, an absolute date, a correction link and a button — so the
           * title truncated and the rest wrapped into nonsense. Vertical space is the cheap
           * dimension here; horizontal is not.
           */
          <div key={t.id} className="flex flex-col gap-2 px-4 py-3.5">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => close(t)}
                disabled={busy === t.id}
                aria-label={`Mark "${t.title}" done`}
                className="mt-0.5 h-5 w-5 shrink-0 rounded-pill border-[1.6px] border-border-strong hover:border-accent disabled:opacity-50"
              />
              <div className="min-w-0 flex-1">
                <div className="text-body font-medium leading-snug">{t.title}</div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-small">
                  {amount && <span className="font-medium text-text">{amount}</span>}
                  {amount && <span className="text-border-strong">·</span>}
                  <span className={TONE[due.tone]}>{due.text}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 pl-8">
              <button type="button" onClick={() => setEditing(t.id)} className="text-small font-medium text-muted hover:text-accent">
                Edit
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => close(t)}
                disabled={busy === t.id}
                className="h-8 shrink-0 rounded-md bg-accent-fill px-4 text-small font-medium text-white disabled:opacity-50"
              >
                {busy === t.id ? "…" : t.kind === "pay" ? "Mark paid" : "Mark done"}
              </button>
            </div>
          </div>
        );
      })}

      {settled.map((t) => (
        <div key={t.id} className="flex items-center gap-3 border-t border-border bg-surface px-4 py-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="shrink-0 text-muted">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5V12l3 1.8" strokeLinecap="round" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-small text-muted">
            {t.title} — {t.status === "done" ? "done" : "dismissed"}
            {t.closedBy ? ` by ${t.closedBy}` : ""}
            {t.closedAt ? ` on ${shortDate(t.closedAt.slice(0, 10))}` : ""}
          </span>
        </div>
      ))}

      {adding ? (
        addForm()
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="border-t border-border px-4 py-2.5 text-left text-small font-medium text-accent">
          + Add another
        </button>
      )}
      {error && <p className="border-t border-border px-4 py-2 text-small text-danger">{error}</p>}
    </section>
  );
}

/**
 * The correction form. Pre-filled with what is stored, so fixing one field never means retyping
 * the other two — and the amount is shown in euros, not the minor units the database keeps.
 */
function EditTask({
  task,
  busy,
  onCancel,
  onSave,
}: {
  task: Task;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: { title: string; amount: string; currency: Currency | null; dueOn: string }) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [amount, setAmount] = useState(task.amountCents === null ? "" : (task.amountCents / 100).toFixed(2));
  // Pre-filled with what the model read, or "?" when it read nothing — never a euro by default.
  const [currency, setCurrency] = useState<Currency | null>(normaliseCurrency(task.currency));
  const [dueOn, setDueOn] = useState(task.dueOn ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ title, amount, currency, dueOn });
      }}
      className="flex flex-col gap-2 px-4 py-3.5"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        className="h-11 rounded-md border border-border-strong px-3 text-body outline-none focus:border-accent lg:h-9 lg:text-row"
      />
      {/* Wraps on a phone: amount, date and both buttons are wider than the sheet together. */}
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
        <label className="flex items-center gap-1.5">
          <span className="text-body text-muted lg:text-small">Amount</span>
          <CurrencySelect value={currency} onChange={setCurrency} className="h-11 text-body lg:h-9 lg:text-row" />
          <input
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="—"
            className="h-11 w-24 rounded-md border border-border-strong px-3 text-body outline-none focus:border-accent lg:h-9 lg:text-row"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-body text-muted lg:text-small">Due</span>
          <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="h-11 rounded-md border border-border-strong px-2 text-body lg:h-9 lg:text-small" />
        </label>
        <div className="flex-1" />
        <button type="button" onClick={onCancel} className="h-11 px-2 text-body text-muted hover:text-text lg:h-9 lg:text-small">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="h-11 rounded-md bg-accent-fill px-4 text-body font-semibold text-white disabled:opacity-50 lg:h-9 lg:px-3 lg:text-small lg:font-medium">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
