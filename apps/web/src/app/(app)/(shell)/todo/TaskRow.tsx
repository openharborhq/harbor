"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TASK_REPEAT_LABEL, dueLabel, formatAmount, shortDate, type Task } from "@harbor/shared";
import { api } from "@/lib/api-client";
import { DocumentPicker } from "@/components/DocumentPicker";

const TONE: Record<ReturnType<typeof dueLabel>["tone"], string> = {
  danger: "text-danger font-medium",
  warn: "text-warn font-medium",
  plain: "text-text",
  muted: "text-muted",
};

/**
 * One row of the list. The checkbox is the whole point of the feature, so it is the first thing
 * under the cursor and the only affordance that needs no menu.
 *
 * Ticking is optimistic: the row greys out immediately and the server call happens behind it. A
 * failure puts it back and says why, because a to-do that silently stayed open is the one failure
 * mode this feature cannot afford.
 */
export function TaskRow({ task, showClosed = false }: { task: Task; showClosed?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [linking, setLinking] = useState(false);

  const due = dueLabel(task.dueOn);
  const amount = formatAmount(task.amountCents, task.currency);
  const closed = task.status !== "open";

  async function close(status: "done" | "dismissed") {
    setBusy(true);
    setError(null);
    setMenuOpen(false);
    try {
      await api(`/tasks/${task.id}/close`, { method: "POST", body: JSON.stringify({ status, reason: null }) });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  /** Attach (or detach) the document this to-do is about, after the fact. */
  async function link(choice: { id: string; title: string; categoryPath: string | null } | null) {
    setBusy(true);
    setError(null);
    try {
      await api(`/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ documentId: choice?.id ?? null }) });
      setLinking(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    setError(null);
    try {
      await api(`/tasks/${task.id}/reopen`, { method: "POST" });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <li className={`flex items-center gap-4 border-t border-border py-3.5 last:border-b ${busy ? "opacity-50" : ""}`}>
      {closed ? (
        <button
          type="button"
          onClick={reopen}
          disabled={busy}
          title={task.status === "done" ? "Mark as not done" : "Put it back on the list"}
          aria-label="Reopen"
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-pill ${task.status === "done" ? "bg-accent text-white" : "bg-surface text-muted"}`}
        >
          {task.status === "done" ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6.5 12.4 3.4 3.4 7.6-8" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => close("done")}
          disabled={busy}
          aria-label={`Mark "${task.title}" done`}
          className="h-5 w-5 shrink-0 rounded-pill border-[1.6px] border-border-strong bg-ground hover:border-accent"
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate text-body ${closed ? "text-muted" : "font-medium"}`}>{task.title}</span>
          {task.repeat && !closed && (
            <span className="inline-flex h-5 shrink-0 items-center rounded-pill bg-surface px-2 text-label font-medium text-muted">
              {TASK_REPEAT_LABEL[task.repeat]}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-small text-muted">
          {closed && showClosed ? (
            <span className="truncate">
              {task.status === "done" ? "Marked done" : "Dismissed"}
              {task.closedBy ? ` by ${task.closedBy}` : ""}
              {task.closedAt ? ` · ${shortDate(task.closedAt.slice(0, 10))}` : ""}
              {task.closedReason ? ` — ${task.closedReason}` : ""}
            </span>
          ) : (
            <>
              {task.document ? (
                <Link href={`/documents/${task.document.id}`} className="truncate text-accent hover:underline">
                  {task.document.title}
                </Link>
              ) : (
                <button type="button" onClick={() => setLinking(true)} className="shrink-0 font-medium text-accent hover:underline">
                  Link a document
                </button>
              )}
              {task.item && (
                <>
                  <span className="text-border-strong">·</span>
                  <Link href={`/items/${task.item.id}`} className="truncate hover:text-text">
                    {task.item.label}
                  </Link>
                </>
              )}
            </>
          )}
        </div>
        {linking && (
          <div className="mt-2 flex items-center gap-2">
            <div className="min-w-0 max-w-[420px] flex-1">
              <DocumentPicker value={null} onChange={(c) => c && link(c)} />
            </div>
            <button type="button" onClick={() => setLinking(false)} className="shrink-0 text-small text-muted hover:text-text">
              Cancel
            </button>
          </div>
        )}
        {error && <div className="mt-1 text-small text-danger">{error}</div>}
      </div>

      <div className="flex w-[110px] shrink-0 justify-end text-body">
        {amount && <span className={closed ? "text-muted" : "font-medium"}>{amount}</span>}
      </div>

      <div className="flex w-[150px] shrink-0 flex-col items-end">
        {closed ? (
          task.dueOn && <span className="text-small text-muted">was due {shortDate(task.dueOn)}</span>
        ) : (
          <>
            <span className={`text-row ${TONE[due.tone]}`}>{due.text}</span>
            {task.dueOn && <span className="text-small text-muted">{shortDate(task.dueOn)}</span>}
          </>
        )}
      </div>

      <div className="relative w-6 shrink-0">
        {!closed && (
          <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-label="More" className="flex h-6 w-6 items-center justify-center text-border-strong hover:text-text">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="12" cy="19" r="1.6" />
            </svg>
          </button>
        )}
        {menuOpen && (
          <div className="absolute right-0 top-7 z-10 w-56 rounded-md border border-border bg-ground p-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setLinking(true);
              }}
              className="w-full rounded px-3 py-2 text-left text-row hover:bg-surface"
            >
              {task.document ? "Link a different document" : "Link a document"}
            </button>
            {task.document && (
              <button type="button" onClick={() => { setMenuOpen(false); void link(null); }} className="w-full rounded px-3 py-2 text-left text-row hover:bg-surface">
                Detach the document
              </button>
            )}
            <button type="button" onClick={() => close("dismissed")} className="w-full rounded px-3 py-2 text-left text-row hover:bg-surface">
              Dismiss — not ours to do
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
