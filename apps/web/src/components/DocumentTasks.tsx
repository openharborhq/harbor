"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { dueSentence, formatAmount, shortDate, type Task } from "@harbor/shared";
import { api } from "@/lib/api-client";

const TONE = { danger: "text-danger", warn: "text-warn", plain: "text-text", muted: "text-muted" } as const;

/**
 * What this document says still has to be done, on the document itself (spec §8).
 *
 * It sits above the summary because if you opened this page from the To do list, the to-do is why
 * you are here. Settled ones stay visible underneath — "July's bill was paid by Dina on 4 Aug" is
 * the context that tells you whether this month's is really outstanding.
 */
export function DocumentTasks({ documentId, tasks }: { documentId: string; tasks: Task[] }) {
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
  async function saveEdit(task: Task, patch: { title: string; amount: string; dueOn: string }) {
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
          currency: cents === null ? null : (task.currency ?? "EUR"),
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
                className="h-8 shrink-0 rounded-md bg-accent px-4 text-small font-medium text-white disabled:opacity-50"
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
        <form onSubmit={add} className="flex flex-col gap-2 border-t border-border p-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What has to happen?"
            maxLength={120}
            className="h-9 rounded-md border border-border-strong px-3 text-row outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="h-9 rounded-md border border-border-strong px-2 text-small" />
            <div className="flex-1" />
            <button type="button" onClick={() => setAdding(false)} className="h-9 px-2 text-small text-muted">
              Cancel
            </button>
            <button type="submit" disabled={busy === "new" || !title.trim()} className="h-9 rounded-md bg-accent px-3 text-small font-medium text-white disabled:opacity-50">
              Add
            </button>
          </div>
        </form>
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
  onSave: (patch: { title: string; amount: string; dueOn: string }) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [amount, setAmount] = useState(task.amountCents === null ? "" : (task.amountCents / 100).toFixed(2));
  const [dueOn, setDueOn] = useState(task.dueOn ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ title, amount, dueOn });
      }}
      className="flex flex-col gap-2 px-4 py-3.5"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        className="h-9 rounded-md border border-border-strong px-3 text-row outline-none focus:border-accent"
      />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span className="text-small text-muted">Amount</span>
          <input
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="—"
            className="h-9 w-28 rounded-md border border-border-strong px-3 text-row outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-small text-muted">Due</span>
          <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="h-9 rounded-md border border-border-strong px-2 text-small" />
        </label>
        <div className="flex-1" />
        <button type="button" onClick={onCancel} className="h-9 px-2 text-small text-muted hover:text-text">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="h-9 rounded-md bg-accent px-3 text-small font-medium text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
