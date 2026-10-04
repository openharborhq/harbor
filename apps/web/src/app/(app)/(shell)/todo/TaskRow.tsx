"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TASK_REPEAT_LABEL, dueLabel, formatAmount, shortDate, type Task } from "@harbor/shared";
import { api } from "@/lib/api-client";
import { DocumentPicker } from "@/components/DocumentPicker";

/** The desktop's date tones — four of them, since its section labels are small and the colour does more work. */
const TONE: Record<ReturnType<typeof dueLabel>["tone"], string> = {
  danger: "lg:text-danger lg:font-medium",
  warn: "lg:text-warn lg:font-medium",
  plain: "lg:text-text lg:font-normal",
  muted: "lg:text-muted lg:font-normal",
};

/** Below lg: late or due today is red, everything else is plain text (a missing date stays muted). */
const PHONE_TONE: Record<ReturnType<typeof dueLabel>["tone"], string> = {
  danger: "text-danger",
  warn: "text-text",
  plain: "text-text",
  muted: "text-muted",
};

/** A menu row: a thumb's 44px below lg, the desktop's compact row from lg. */
const MENU_ITEM = "flex min-h-11 w-full items-center rounded px-3 py-2 text-left text-body hover:bg-surface lg:min-h-0 lg:text-row";

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
    <li className={`flex min-h-16 items-start gap-3 border-t border-border py-4 last:border-b lg:min-h-0 lg:gap-4 lg:py-3.5 ${busy ? "opacity-50" : ""}`}>
      {/*
        28px on a phone, drawn inside a 44px hit area (the ::after), because the tick is the one
        thing on this page a thumb has to land on without looking twice.
      */}
      {closed ? (
        <button
          type="button"
          onClick={reopen}
          disabled={busy}
          title={task.status === "done" ? "Mark as not done" : "Put it back on the list"}
          aria-label="Reopen"
          className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-pill after:absolute after:-inset-2 after:content-[''] lg:mt-0.5 lg:h-5 lg:w-5 lg:after:hidden ${task.status === "done" ? "bg-accent-fill text-white" : "bg-surface text-muted"}`}
        >
          {task.status === "done" ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 lg:h-3 lg:w-3">
              <path d="m6.5 12.4 3.4 3.4 7.6-8" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="h-3.5 w-3.5 lg:h-[11px] lg:w-[11px]">
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
          className="relative h-7 w-7 shrink-0 rounded-pill border-[1.8px] border-border-strong bg-ground after:absolute after:-inset-2 after:content-[''] hover:border-accent lg:mt-0.5 lg:h-5 lg:w-5 lg:border-[1.6px] lg:after:hidden"
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate text-copy font-semibold lg:text-body ${closed ? "text-muted lg:font-normal" : "lg:font-medium"}`}>{task.title}</span>
          {task.repeat && !closed && (
            <span className="hidden h-5 shrink-0 items-center rounded-pill bg-surface px-2 text-label font-medium text-muted lg:inline-flex">
              {TASK_REPEAT_LABEL[task.repeat]}
            </span>
          )}
        </div>
        {/*
          The phone's second line is the document and nothing else (plus how often it repeats, in
          words rather than an 11px chip). The person or thing is the desktop's — the title nearly
          always names them already, and a third truncated fragment helped nobody.
        */}
        <div className="mt-0.5 flex items-center gap-2 text-body text-muted lg:text-small">
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
              {task.repeat && !closed && <span className="shrink-0 lg:hidden">· {TASK_REPEAT_LABEL[task.repeat]}</span>}
              {task.item && (
                <>
                  <span className="hidden text-border-strong lg:inline">·</span>
                  <Link href={`/items/${task.item.id}`} className="hidden truncate hover:text-text lg:inline">
                    {task.item.label}
                  </Link>
                </>
              )}
            </>
          )}
        </div>
        {linking && (
          <div className="mt-2 flex items-center gap-2">
            {/* The picker is shared; its 36px field is raised to a thumb's 44 from here. */}
            <div className="min-w-0 max-w-[420px] flex-1 [&_input]:h-11 lg:[&_input]:h-9">
              <DocumentPicker value={null} onChange={(c) => c && link(c)} />
            </div>
            <button type="button" onClick={() => setLinking(false)} className="h-11 shrink-0 px-1 text-body text-muted hover:text-text lg:h-auto lg:px-0 lg:text-small">
              Cancel
            </button>
          </div>
        )}
        {error && <div className="mt-1 text-body text-danger lg:text-small">{error}</div>}
      </div>

      <div className="hidden w-[110px] shrink-0 justify-end pt-px text-body lg:flex">
        {amount && <span className={closed ? "text-muted" : "font-medium"}>{amount}</span>}
      </div>

      {/*
        The date, and only the date. The section heading above already says whether this is
        overdue or merely coming, and the colour repeats it — so "in 3 weeks" beside "1 Oct" was
        the same fact told twice in a row that had no room for it.
      */}
      {/*
        On a phone this is the whole right lane, 80px: the date over the amount. Two colours only
        there — danger for overdue and today, text for the rest — since the heading carries the
        nuance the desktop's amber "this week" adds.
      */}
      <div className="flex w-20 shrink-0 flex-col items-end gap-0.5 lg:w-[110px]">
        {closed ? (
          task.dueOn && (
            <>
              <span className="text-body font-semibold text-muted lg:hidden">{shortDate(task.dueOn)}</span>
              <span className="hidden text-small text-muted lg:inline">was due {shortDate(task.dueOn)}</span>
            </>
          )
        ) : (
          <span className={`text-body font-semibold lg:text-row ${PHONE_TONE[due.tone]} ${TONE[due.tone]}`}>{task.dueOn ? shortDate(task.dueOn) : "No date"}</span>
        )}
        {amount && <span className={`whitespace-nowrap text-body lg:hidden ${closed ? "text-muted" : "font-medium"}`}>{amount}</span>}
      </div>

      {/*
        Straight to the paperwork. Only offered when there is a document behind the to-do — a
        fetch reminder has none yet, and the row already says "Link a document" in its place.
      */}
      {/* Not below lg: the document's title in the line under the to-do is the same link. */}
      <div className="hidden w-[62px] shrink-0 justify-end lg:flex">
        {task.document && (
          <Link
            href={`/documents/${task.document.id}`}
            className="flex h-8 items-center rounded-md border border-border-strong bg-ground px-3 text-small font-medium text-text hover:border-accent hover:text-accent"
          >
            View
          </Link>
        )}
      </div>

      {/*
        The "…" stays on a phone — it holds linking and dismissing — but as a 44px-tall target
        whose hit area (the ::after) reaches 44 wide without widening the lane it is drawn in.
      */}
      <div className="relative -my-2.5 -mr-1 w-6 shrink-0 lg:my-0 lg:mr-0">
        {!closed && (
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="More"
            className="relative flex h-11 w-6 items-center justify-center text-border-strong after:absolute after:-inset-x-2.5 after:inset-y-0 after:content-[''] hover:text-text lg:h-6 lg:after:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 lg:h-4 lg:w-4">
              <circle cx="12" cy="5" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="12" cy="19" r="1.6" />
            </svg>
          </button>
        )}
        {menuOpen && (
          <div className="absolute right-0 top-11 z-10 w-64 rounded-md border border-border bg-ground p-1 shadow-lg lg:top-7 lg:w-56">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setLinking(true);
              }}
              className={MENU_ITEM}
            >
              {task.document ? "Link a different document" : "Link a document"}
            </button>
            {task.document && (
              <button type="button" onClick={() => { setMenuOpen(false); void link(null); }} className={MENU_ITEM}>
                Detach the document
              </button>
            )}
            <button type="button" onClick={() => close("dismissed")} className={MENU_ITEM}>
              Dismiss — not ours to do
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
