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

  return (
    <>
      <TopBar />
      <main className="flex max-w-[1192px] flex-col px-14 py-11">
        <div className="flex flex-wrap items-end gap-6 pb-2">
          <div className="flex min-w-[320px] flex-1 flex-col gap-2">
            <h1 className="text-title font-bold tracking-snug">To do</h1>
            <div className="flex items-center gap-2 text-body">
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
            <section key={bucket} className="mt-9 flex flex-col">
              <div className="flex items-center gap-2.5 pb-1.5">
                <span className={`label ${bucket === "overdue" ? "text-danger" : "text-muted"}`}>{TASK_BUCKET_LABEL[bucket]}</span>
                <span className="label text-border-strong">{inBucket.length}</span>
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
          <section className="mt-11 flex flex-col">
            <div className="flex items-center gap-2.5 pb-1.5">
              <span className="label text-muted">Done</span>
              <span className="label text-border-strong">{settled.length} kept</span>
            </div>
            <ul className="flex flex-col">
              {settled.slice(0, DONE_SHOWN).map((t) => (
                <TaskRow key={t.id} task={t} showClosed />
              ))}
            </ul>
            {settled.length > DONE_SHOWN && (
              <p className="pt-3.5 text-small text-muted">
                {settled.length - DONE_SHOWN} more kept — nothing here is ever deleted, so “did we pay that?” stays answerable.
              </p>
            )}
          </section>
        )}
      </main>
    </>
  );
}
