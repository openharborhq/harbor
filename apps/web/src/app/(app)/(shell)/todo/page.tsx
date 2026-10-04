import type { Metadata } from "next";
import {
  TASK_BUCKETS,
  TASK_BUCKET_LABEL,
  formatAmount,
  taskBucket,
  todayIso,
  type Item,
  type Task,
  type TaskCount,
} from "@harbor/shared";
import { TopBar } from "@/components/shell/TopBar";
import { EmptyState } from "@/components/EmptyState";
import { apiFetch } from "@/lib/api-server";
import { AddTask } from "./AddTask";
import { TaskRow } from "./TaskRow";

export const metadata: Metadata = { title: "To do" };

const DONE_SHOWN = 5;

/**
 * Everything the vault says still has to be done (spec §8).
 *
 * Grouped by when rather than by kind: nobody thinks "show me my renewals", they think "what is
 * late". Done is kept below rather than hidden, because "did we ever pay that?" is a question this
 * page should still be able to answer next year.
 */
export default async function TodoPage() {
  const [open, closed, count, items] = await Promise.all([
    apiFetch<Task[]>("/tasks?status=open"),
    apiFetch<Task[]>("/tasks?status=done&limit=50"),
    apiFetch<TaskCount>("/tasks/count"),
    apiFetch<Item[]>("/items").catch(() => [] as Item[]),
  ]);
  const dismissed = await apiFetch<Task[]>("/tasks?status=dismissed&limit=20").catch(() => [] as Task[]);
  const today = todayIso();
  const settled = [...closed, ...dismissed].sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
  // One figure per currency; see TaskCount for why this is not a single total.
  const unpaid = count.unpaid.map((u) => formatAmount(u.cents, u.currency)).filter(Boolean).join(" · ");
  const overdue = open.filter((t) => taskBucket(t.dueOn, today) === "overdue").length;
  /*
   * The phone's headline figure. One currency reads as one number, in whole units like the design
   * ("€1,337") — the rows below carry the cents, and at 30px they push a third column off a
   * 390px screen. Several currencies keep the exact joined string, set smaller, because rounding
   * two different moneys into one big line would invite adding them up.
   */
  const [only] = count.unpaid;
  const unpaidFigure =
    count.unpaid.length === 1 && only ? formatAmount(Math.round(only.cents / 100) * 100, only.currency)?.replace(/\.00$/, "") : null;

  return (
    <>
      <TopBar />
      <main className="mx-auto flex w-full max-w-[1192px] flex-col px-4 py-8 sm:px-8 lg:px-14 lg:py-11">
        {/*
          Phones get the design's three totals under the title and a full-width "Add a to-do";
          from lg the original summary sentence and the button beside the title come back. One
          tree with variants: the button is the same component, only its box changes.
        */}
        <div className="flex flex-col gap-5 lg:flex-row lg:flex-wrap lg:items-end lg:gap-6 lg:pb-2">
          <div className="flex flex-col gap-3.5 lg:min-w-[280px] lg:flex-1 lg:gap-2">
            <h1 className="text-title font-extrabold tracking-tight lg:font-bold lg:tracking-snug">To do</h1>
            <dl className="flex max-w-[520px] gap-3 lg:hidden">
              <div className="flex flex-1 basis-0 flex-col gap-0.5">
                <dt className="order-last text-body text-muted">overdue</dt>
                <dd className={`text-[30px] font-extrabold leading-9 tracking-snug ${overdue > 0 ? "text-danger" : "text-text"}`}>{overdue}</dd>
              </div>
              <div className="flex flex-1 basis-0 flex-col gap-0.5">
                <dt className="order-last text-body text-muted">open</dt>
                <dd className="text-[30px] font-extrabold leading-9 tracking-snug">{count.open}</dd>
              </div>
              {unpaid && (
                <div className="flex min-w-0 flex-[1.6] basis-0 flex-col gap-0.5">
                  <dt className="order-last text-body text-muted">still to pay</dt>
                  {unpaidFigure ? (
                    <dd title={unpaid} className="whitespace-nowrap text-[30px] font-extrabold leading-9 tracking-snug">{unpaidFigure}</dd>
                  ) : (
                    <dd className="flex min-h-9 items-end text-copy font-bold tracking-snug">{unpaid}</dd>
                  )}
                </div>
              )}
            </dl>
            <div className="hidden flex-wrap items-center gap-x-2 gap-y-1 text-body lg:flex">
              {count.pressing > 0 ? (
                <span className="font-medium text-danger">
                  {count.pressing} overdue or due today
                </span>
              ) : (
                <span className="text-muted">Nothing is late</span>
              )}
              <span className="text-border-strong">·</span>
              <span className="text-muted">{count.open} open</span>
              {unpaid && (
                <>
                  <span className="text-border-strong">·</span>
                  <span className="text-muted">{unpaid} unpaid</span>
                </>
              )}
            </div>
          </div>
          <AddTask items={items} />
        </div>

        {open.length === 0 && (
          <div className="mt-8">
            <EmptyState
              title="Nothing to do"
              body="When a bill, a form or a deadline is filed, Harbor offers to remember it here — you tick it off when it is done. You can also add one yourself."
            />
          </div>
        )}

        {TASK_BUCKETS.map((bucket) => {
          const inBucket = open.filter((t) => taskBucket(t.dueOn, today) === bucket);
          if (inBucket.length === 0) return null;
          return (
            <section key={bucket} className="mt-7 flex flex-col lg:mt-9">
              {/*
                A phone heading is the bucket's name at reading size and nothing else; the small
                uppercase label and its count are the desktop's, where the rows are dense enough
                to need a tally.
              */}
              <div className="flex items-center gap-2.5 pb-2 lg:pb-1.5">
                <h2 className={`text-lead font-bold tracking-snug lg:hidden ${bucket === "overdue" ? "text-danger" : "text-text"}`}>{TASK_BUCKET_LABEL[bucket]}</h2>
                <span className={`hidden lg:inline label ${bucket === "overdue" ? "text-danger" : "text-muted"}`}>{TASK_BUCKET_LABEL[bucket]}</span>
                <span className="hidden lg:inline label text-border-strong">{inBucket.length}</span>
              </div>
              <ul className="flex flex-col">
                {inBucket.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </ul>
            </section>
          );
        })}

        {settled.length > 0 && (
          <section className="mt-7 flex flex-col lg:mt-11">
            <div className="flex items-center gap-2.5 pb-2 lg:pb-1.5">
              <h2 className="text-lead font-bold tracking-snug lg:hidden">Done</h2>
              <span className="hidden lg:inline label text-muted">Done</span>
              <span className="hidden lg:inline label text-border-strong">{settled.length} kept</span>
            </div>
            <ul className="flex flex-col">
              {settled.slice(0, DONE_SHOWN).map((t) => (
                <TaskRow key={t.id} task={t} showClosed />
              ))}
            </ul>
            {settled.length > DONE_SHOWN && (
              <p className="pt-3.5 text-body text-muted lg:text-small">
                {settled.length - DONE_SHOWN} more kept — nothing here is ever deleted, so “did we pay that?” stays answerable.
              </p>
            )}
          </section>
        )}
      </main>
    </>
  );
}
