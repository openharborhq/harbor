import { z } from "zod/v4";

/**
 * Tasks — the things a document says you still have to *do* (spec §8).
 *
 * Separate from `documents.expires_at` on purpose. A passport expires on its own and is resolved
 * by filing a new one; a bill is discharged by an act in the world the vault cannot observe. The
 * missing primitive was never a date — it was *done*, which has an actor and a time.
 */
export const TaskKind = z.enum(["pay", "file", "renew", "fetch", "review"]);
export type TaskKind = z.infer<typeof TaskKind>;

export const TASK_KIND_VERB: Record<TaskKind, string> = {
  pay: "Pay",
  file: "Send or file",
  renew: "Renew",
  fetch: "Fetch",
  review: "Read and decide",
};

/**
 * Three states, not two. "Dismissed" is not a quiet synonym for done: the repair share settled by
 * the landlord was never paid by this household, and a list that claimed otherwise would be lying
 * in the one place people go to check.
 */
export const TaskStatus = z.enum(["open", "done", "dismissed"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/**
 * Repetition as a named cadence rather than an interval.
 *
 * Completing a repeating task inserts the next single row, dated from the one just closed. No
 * scheduler, no rrule, no catching up on occurrences nobody was there for — and a quarterly
 * Abschlag still works.
 */
export const TaskRepeat = z.enum(["monthly", "quarterly", "yearly", "two_yearly"]);
export type TaskRepeat = z.infer<typeof TaskRepeat>;

export const TASK_REPEAT_LABEL: Record<TaskRepeat, string> = {
  monthly: "Every month",
  quarterly: "Every quarter",
  yearly: "Every year",
  two_yearly: "Every 2 years",
};

const TASK_REPEAT_MONTHS: Record<TaskRepeat, number> = { monthly: 1, quarterly: 3, yearly: 12, two_yearly: 24 };

/**
 * The currencies a to-do can carry. Four, deliberately: this household's paperwork arrives in
 * euros and dollars with the odd British or Swiss bill, and a select of 180 codes turns a
 * one-glance correction into a scroll. Null is a real value — the document did not say — and it
 * is shown as such rather than quietly defaulted, because "€5,792.25" on a Vermont tax bill is
 * wrong in a way "5,792.25" is not.
 */
export const Currency = z.enum(["EUR", "USD", "GBP", "CHF"]);
export type Currency = z.infer<typeof Currency>;

export const CURRENCY_SYMBOL: Record<Currency, string> = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF " };

const CURRENCY_ALIASES: Record<string, Currency> = {
  "€": "EUR", EURO: "EUR", EUROS: "EUR",
  "$": "USD", "US$": "USD", DOLLAR: "USD", DOLLARS: "USD",
  "£": "GBP", POUND: "GBP", POUNDS: "GBP", STERLING: "GBP",
  FR: "CHF", SFR: "CHF", FRANKEN: "CHF", FRANCS: "CHF",
};

/**
 * What a model wrote into `currency`, or a person typed, as one of ours — or null when it is
 * nothing recognisable. "Euro", "€", "eur" and "EUR" are one thing; an unknown code is not a
 * currency the list can show, so it reads as "not stated" rather than being guessed at.
 */
export function normaliseCurrency(raw: string | null | undefined): Currency | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  const code = CURRENCY_ALIASES[s] ?? s;
  return Currency.safeParse(code).success ? (code as Currency) : null;
}

export const Task = z.object({
  id: z.string().uuid(),
  title: z.string(),
  kind: TaskKind,
  /** Null is allowed: "ask the Hausverwaltung about the meter" is a real task with no deadline. */
  dueOn: z.string().date().nullable(),
  /** Minor units, so €248.10 is 24810. Null on everything that is not a payment. */
  amountCents: z.number().int().nullable(),
  currency: z.string().nullable(),
  repeat: TaskRepeat.nullable(),
  status: TaskStatus,
  document: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  item: z.object({ id: z.string().uuid(), label: z.string() }).nullable(),
  notes: z.string().nullable(),
  source: z.enum(["manual", "suggested"]),
  createdAt: z.string().datetime(),
  createdBy: z.string().nullable(),
  /** Set on done *or* dismissed — the moment someone settled it, and who. */
  closedAt: z.string().datetime().nullable(),
  closedBy: z.string().nullable(),
  /** Why it was dismissed, when someone said. Never shown for a completed task. */
  closedReason: z.string().nullable(),
});
export type Task = z.infer<typeof Task>;

export const CreateTask = z.object({
  title: z.string().trim().min(1).max(120),
  kind: TaskKind.default("review"),
  dueOn: z.string().date().nullable().default(null),
  amountCents: z.number().int().nonnegative().nullable().default(null),
  /** One of ours, or null for "the document did not say" — never free text, which is how a task ended up in "Euro". */
  currency: Currency.nullable().default(null),
  repeat: TaskRepeat.nullable().default(null),
  documentId: z.string().uuid().nullable().default(null),
  itemId: z.string().uuid().nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
});
export type CreateTask = z.infer<typeof CreateTask>;

export const UpdateTask = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  kind: TaskKind.optional(),
  dueOn: z.string().date().nullable().optional(),
  amountCents: z.number().int().nonnegative().nullable().optional(),
  currency: Currency.nullable().optional(),
  repeat: TaskRepeat.nullable().optional(),
  /**
   * A to-do written before its paperwork arrived — "pay the boiler service" typed on Tuesday,
   * the invoice filed on Thursday — has to be able to find its document afterwards. `null`
   * detaches it again without deleting anything.
   */
  documentId: z.string().uuid().nullable().optional(),
  itemId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpdateTask = z.infer<typeof UpdateTask>;

/** Closing one. A dismissal may carry a reason; completing one never needs an excuse. */
export const CloseTask = z.object({
  status: z.enum(["done", "dismissed"]),
  reason: z.string().trim().max(200).nullable().default(null),
});
export type CloseTask = z.infer<typeof CloseTask>;

export const ListTasksQuery = z.object({
  status: TaskStatus.optional(),
  document: z.string().uuid().optional(),
  item: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListTasksQuery = z.infer<typeof ListTasksQuery>;

/**
 * What the sidebar badge shows, and what Home leads with.
 *
 * `pressing` is deliberately not "everything open": a badge that counts a renewal due in eleven
 * weeks can never reach zero, and a badge that can never reach zero is wallpaper. Same reasoning
 * that keeps `notPaperwork` out of the Inbox badge.
 */
export const TaskCount = z.object({
  pressing: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  /**
   * What is outstanding, one entry per currency, largest first.
   *
   * Not a single number: adding dollars to euros produces a figure that is wrong in every
   * currency, and a vault that holds a Vermont property tax bill beside a Stadtwerke invoice
   * really does hold both. Empty when nothing open carries an amount.
   */
  unpaid: z.array(z.object({ currency: z.string(), cents: z.number().int() })),
});
export type TaskCount = z.infer<typeof TaskCount>;

// ---------- one place where "when is this due" is decided ----------

export type TaskBucket = "overdue" | "today" | "week" | "later" | "someday";

export const TASK_BUCKET_LABEL: Record<TaskBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  someday: "No date",
};

/** The order the buckets appear in, everywhere they appear. */
export const TASK_BUCKETS: TaskBucket[] = ["overdue", "today", "week", "later", "someday"];

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function daysUntil(dueOn: string, today: string): number {
  return Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function taskBucket(dueOn: string | null, today: string = todayIso()): TaskBucket {
  if (!dueOn) return "someday";
  const days = daysUntil(dueOn, today);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "week";
  return "later";
}

/**
 * What the badge counts, and the single definition of "pressing". Exported so the API's count and
 * the page's own grouping cannot drift into disagreeing about the same number.
 */
export function isPressing(dueOn: string | null, today: string = todayIso()): boolean {
  const bucket = taskBucket(dueOn, today);
  return bucket === "overdue" || bucket === "today";
}

/** How a due date reads to a person, plus how loudly it should be said. */
export function dueLabel(dueOn: string | null, today: string = todayIso()): { text: string; tone: "danger" | "warn" | "plain" | "muted" } {
  if (!dueOn) return { text: "No date", tone: "muted" };
  const days = daysUntil(dueOn, today);
  if (days < 0) return { text: days === -1 ? "1 day overdue" : `${-days} days overdue`, tone: "danger" };
  if (days === 0) return { text: "Due today", tone: "danger" };
  if (days === 1) return { text: "Due tomorrow", tone: "warn" };
  if (days <= 7) return { text: `Due ${weekdayOf(dueOn)}`, tone: "warn" };
  if (days <= 27) return { text: days <= 13 ? "in 1 week" : `in ${Math.round(days / 7)} weeks`, tone: "plain" };
  const months = Math.round(days / 30);
  return { text: months <= 1 ? "in a month" : `in ${months} months`, tone: "plain" };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function weekdayOf(iso: string): string {
  return WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()] ?? iso;
}

/** "2 Sep", "30 Nov 2027" — the short form used beside every relative label. */
export function shortDate(iso: string, today: string = todayIso()): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return sameYear ? `${d.getUTCDate()} ${month}` : `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

export function formatAmount(amountCents: number | null, currency: string | null): string | null {
  if (amountCents === null) return null;
  // Grouped, because "$5792.25" makes a reader count digits and "$5,792.25" does not.
  const value = (amountCents / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // No currency means the document did not say. That shows as a bare figure — never as a euro
  // sign assumed on its behalf, which is what this did until a dollar bill came through in euros.
  const code = normaliseCurrency(currency);
  if (!code) return currency?.trim() ? `${currency.trim()} ${value}` : value;
  return `${CURRENCY_SYMBOL[code]}${value}`;
}

/**
 * One line saying when a to-do is due, for places too narrow to stack a relative label above a
 * date — the document strip, mainly.
 *
 * A date only earns the words "was due" once it has passed. Printing "in 3 weeks · was due 1 Oct"
 * beside each other, as the first draft did, is a sentence that contradicts itself.
 */
export function dueSentence(dueOn: string | null, today: string = todayIso()): { text: string; tone: "danger" | "warn" | "plain" | "muted" } {
  if (!dueOn) return { text: "No date set", tone: "muted" };
  const { text, tone } = dueLabel(dueOn, today);
  const days = daysUntil(dueOn, today);
  if (days < 0) return { text: `${text} · was due ${shortDate(dueOn, today)}`, tone };
  if (days === 0) return { text, tone };
  return { text: `due ${shortDate(dueOn, today)} · ${text.replace(/^Due /, "")}`, tone };
}

/** The date the next occurrence of a repeating task falls on, counted from the one just closed. */
export function nextDueOn(dueOn: string, repeat: TaskRepeat): string {
  const d = new Date(`${dueOn}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + TASK_REPEAT_MONTHS[repeat]);
  // Clamp, so the 31st of a month rolls to the 30th rather than overflowing into the next one.
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}
