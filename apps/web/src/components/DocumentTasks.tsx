"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { dueLabel, formatAmount, shortDate, type Task } from "@harbor/shared";
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
        const due = dueLabel(t.dueOn);
        const amount = formatAmount(t.amountCents, t.currency);
        return (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3.5">
            <button
              type="button"
              onClick={() => close(t)}
              disabled={busy === t.id}
              aria-label={`Mark "${t.title}" done`}
              className="h-5 w-5 shrink-0 rounded-pill border-[1.6px] border-border-strong hover:border-accent disabled:opacity-50"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-body font-medium">{t.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-small">
                {amount && <span className="text-text">{amount}</span>}
                {amount && <span className="text-border-strong">·</span>}
                <span className={TONE[due.tone]}>{due.text}</span>
                {t.dueOn && (
                  <>
                    <span className="text-border-strong">·</span>
                    <span className="text-muted">was due {shortDate(t.dueOn)}</span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => close(t)}
              disabled={busy === t.id}
              className="h-8 shrink-0 rounded-md bg-accent px-4 text-small font-medium text-white disabled:opacity-50"
            >
              {busy === t.id ? "…" : t.kind === "pay" ? "Mark paid" : "Mark done"}
            </button>
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
