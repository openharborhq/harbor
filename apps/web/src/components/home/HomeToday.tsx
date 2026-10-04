import Link from "next/link";
import { formatAmount, type HomeData } from "@harbor/shared";
import { ItemAvatar } from "@/components/ItemAvatar";

/**
 * Home on a phone: what needs doing today, then who and what the vault is about.
 *
 * The desktop Home is an overview — four grids, side by side. On a phone the same page is opened
 * to answer one question, "is there anything I have to do?", so the answer comes first, as a
 * sentence, and the grids become a strip and a short list under it. Categories are left to the
 * Library, which the search field and the menu both reach.
 */
export function HomeToday({ h, inboxCount }: { h: HomeData; inboxCount: number }) {
  // Only what is due within a month counts as needing the person. A passport with five months
  // left is on the desktop panel and on To do; on a phone's first screen it would be noise, and
  // it would make the headline a number nobody can act on today.
  const pressing = h.needsAttention.filter((e) => e.daysLeft !== null && e.daysLeft <= 30).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const count = pressing.length + (inboxCount > 0 ? 1 : 0);
  const late = pressing.filter((e) => (e.daysLeft ?? 0) <= 0);
  const later = pressing.filter((e) => (e.daysLeft ?? 0) > 0);

  // Overdue and due-today outrank the Inbox; the Inbox outranks what is merely coming up.
  const rows: Row[] = [...late.map(attention), ...(inboxCount > 0 ? [{ kind: "inbox" as const }] : []), ...later.map(attention)].slice(0, ROW_LIMIT);
  const hiddenTasks = h.needsAttention.length - rows.filter((r) => r.kind !== "inbox").length;
  const people = [...h.family, ...h.things];

  return (
    <main className="flex w-full flex-col px-5 pt-2.5 pb-12 sm:px-8 lg:hidden">
      <div className="flex flex-col gap-2">
        <p className="text-body text-muted">{longDate(new Date())}</p>
        <h1 className="max-w-[260px] text-display font-extrabold tracking-tight">{headline(count)}</h1>
      </div>

      {/* The top bar drops its search below lg, so Home carries it: the first thing most visits
          to a vault are for is finding one document. A plain GET form — it lands on the same
          results page the desktop search does, with no script involved. */}
      <form action="/library" method="get" role="search" className="pt-5">
        <label className="flex h-12 items-center gap-2.5 rounded-lg bg-surface px-3.5">
          <SearchIcon />
          <span className="sr-only">Search</span>
          <input
            type="search"
            name="q"
            placeholder="Search inside every document"
            className="min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-muted"
          />
        </label>
      </form>

      <section aria-label="Needs you" className="pt-5">
        {rows.length === 0 ? (
          <p className="border-y border-border py-4 text-body text-muted">Nothing is due in the next 30 days and the Inbox is empty.</p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((r) => (r.kind === "inbox" ? <InboxRow key="inbox" n={inboxCount} /> : <AttentionRow key={`${r.e.kind}-${r.e.id}`} e={r.e} />))}
          </ul>
        )}
        {hiddenTasks > 0 && (
          <Link href="/todo" className="flex min-h-11 items-center text-copy font-semibold text-accent">
            See all
          </Link>
        )}
      </section>

      <section className="flex flex-col gap-3.5 pt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lead font-bold tracking-snug">People &amp; things</h2>
          {people.length > 0 && (
            <Link href="/items" className="text-copy font-semibold text-accent">
              All {people.length}
            </Link>
          )}
        </div>
        {h.family.length === 0 && (
          <Link href="/items" className="flex min-h-11 items-center text-copy font-semibold text-accent">
            Add your family
          </Link>
        )}
        {people.length > 0 && (
          // Bleeds off the right edge on purpose: a strip cut by the screen says "there is more
          // this way" without a word or an arrow. The negative margin and matching padding let it
          // run to the edge while the first avatar still lines up with the text above.
          <ul className="scrollbar-none -mr-5 flex gap-3 overflow-x-auto pr-5 sm:-mr-8 sm:pr-8">
            {people.map((i) => (
              <li key={i.id} className="relative w-[72px] shrink-0">
                <Link href={`/items/${i.id}`} className="flex flex-col items-center gap-2">
                  <span className="relative">
                    <ItemAvatar item={i} size={64} textSize="text-[22px]" />
                    {i.next && i.next.daysLeft <= 30 && (
                      <span className="absolute top-0.5 right-0.5 h-3 w-3 rounded-pill border-2 border-ground bg-warn">
                        <span className="sr-only">Something expires in {i.next.daysLeft} days</span>
                      </span>
                    )}
                  </span>
                  {/* A household shares a surname, so at 72px "Anna M…" says less than "Anna";
                      the full label stays in the link's name. */}
                  <span className="w-full truncate text-center text-body font-medium" aria-hidden>
                    {i.kind === "person" ? i.label.split(/\s+/)[0] : i.label}
                  </span>
                  <span className="sr-only">{i.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-1.5 pt-6">
        <h2 className="text-lead font-bold tracking-snug">Recently added</h2>
        {h.recentlyAdded.length === 0 ? (
          <div className="flex flex-col py-2">
            <p className="text-body text-muted">Nothing in the vault yet.</p>
            <Link href="/add" className="flex min-h-11 items-center text-copy font-semibold text-accent">
              Add documents
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col">
            {h.recentlyAdded.slice(0, 3).map((d) => (
              <li key={d.documentId} className="flex min-h-16 items-center gap-3.5 py-2.5">
                <div className="h-[46px] w-9 shrink-0 rounded-sm border border-border bg-surface" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link href={`/documents/${d.documentId}`} className="truncate text-copy font-semibold hover:text-accent">
                    {d.title}
                  </Link>
                  <div className={`truncate text-body ${d.needsFiling ? "text-accent" : "text-muted"}`}>
                    {d.needsFiling ? "Needs filing" : (d.categoryPath?.split(" › ").pop() ?? (d.source === "email" ? "Email" : "Upload"))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

type Entry = HomeData["needsAttention"][number];
type Row = { kind: "attention"; e: Entry } | { kind: "inbox" };
const attention = (e: Entry): Row => ({ kind: "attention", e });

/** Four rows fit above the fold of a small phone with the headline and search above them. */
const ROW_LIMIT = 4;

const ROW = "flex min-h-16 items-center gap-3.5 border-t border-border py-3.5 last:border-b";

function AttentionRow({ e }: { e: Entry }) {
  const days = e.daysLeft ?? 0;
  const amount = formatAmount(e.amountCents, e.currency);
  const line = [e.subtitle ?? (e.kind === "task" ? "Nothing filed yet" : null), amount].filter(Boolean).join(" · ");
  return (
    <li className={ROW}>
      {/* A to-do can be ticked off; an expiry cannot — the same distinction the desktop panel
          draws, so the glyphs are the same too. */}
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
        {e.kind === "task" ? <span className="h-[22px] w-[22px] rounded-pill border-[1.6px] border-border-strong" aria-label="To do" /> : <DocIcon />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {e.documentId ? (
          <Link href={`/documents/${e.documentId}`} className="truncate text-copy font-semibold hover:text-accent">
            {e.title}
          </Link>
        ) : (
          <span className="truncate text-copy font-semibold">{e.title}</span>
        )}
        {line && <div className="truncate text-body text-muted">{line}</div>}
      </div>
      <span className={`w-20 shrink-0 text-right text-body font-semibold ${days <= 0 ? "text-danger" : "text-warn"}`}>
        {days < 0 ? `${-days} d late` : days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}
      </span>
    </li>
  );
}

function InboxRow({ n }: { n: number }) {
  return (
    <li className={ROW}>
      <span className="flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-pill bg-accent-fill px-1 text-[12px] leading-4 font-bold text-white">
        {n}
      </span>
      <Link href="/inbox" className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-copy font-semibold">
          File {inWords(n)} new document{n === 1 ? "" : "s"}
        </span>
        {/* Where they are, not a promise about them: a document read in offline mode, or with too
            little text on the page, arrives with no suggestion at all. */}
        <span className="truncate text-body text-muted">Waiting in the Inbox</span>
      </Link>
      <Link href="/inbox" className="w-20 shrink-0 text-right text-body font-semibold text-accent">
        Review
      </Link>
    </li>
  );
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "three", "12" — words up to ten read as a sentence; past that a numeral reads faster. */
function inWords(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function headline(n: number): string {
  if (n === 0) return "Nothing needs you.";
  const word = inWords(n);
  const lead = word.charAt(0).toUpperCase() + word.slice(1);
  return n === 1 ? `${lead} thing needs you.` : `${lead} things need you.`;
}

/**
 * "Sunday, 4 October" — spelled out from fixed tables rather than asked of `toLocaleString`, for
 * the reason given at SHORT_MONTHS in @harbor/shared: the runtimes disagree on English month and
 * day names. Read in UTC, the same day the API counts `daysLeft` from.
 */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function longDate(d: Date): string {
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function SearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-warn" role="img" aria-label="Expires">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}
