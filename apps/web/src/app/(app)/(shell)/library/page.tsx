import type { Metadata } from "next";
import Link from "next/link";
import { ACTIVE_ITEM_KINDS, ITEM_KIND_LABEL, type Category, type DocumentSummary, type Item, type SearchResponse } from "@harbor/shared";
import { ShareCheckbox } from "@/components/share/ShareCheckbox";
import { LibrarySearchField } from "@/components/LibrarySearchField";
import { Snippet } from "@/components/Snippet";
import { ListStatusPill } from "@/components/StatusPill";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";
import { formatDate, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Library" };

const SORTS: { key: string; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "title", label: "Title A–Z" },
  { key: "date", label: "Document date" },
  { key: "expires", label: "Expiring first" },
];

export default async function LibraryPage(props: PageProps<"/library">) {
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const q = str("q");

  if (q) return <SearchResults q={q} inPath={str("in")} source={str("source")} />;

  const category = str("category");
  const itemId = str("item");
  const source = str("source");
  const sort = SORTS.some((s) => s.key === str("sort")) ? str("sort") : "newest";
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (itemId) params.set("item", itemId);
  if (source) params.set("source", source);
  params.set("sort", sort);

  const [docs, categories, items, all] = await Promise.all([
    apiFetch<DocumentSummary[]>(`/documents?${params}`),
    apiFetch<Category[]>("/categories"),
    apiFetch<Item[]>("/items"),
    apiFetch<DocumentSummary[]>("/documents?limit=500"),
  ]);
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `/library?${p}`;
  };
  const tops = categories.filter((c) => c.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
  const kids = (id: string) => categories.filter((c) => c.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder);
  const countTop = (id: string) => (categories.find((c) => c.id === id)?.documentCount ?? 0) + kids(id).reduce((n, c) => n + c.documentCount, 0);
  const activeCat = categories.find((c) => c.id === category);
  const activeTop = activeCat ? (activeCat.parentId ? categories.find((c) => c.id === activeCat.parentId) : activeCat) : undefined;
  const bySource = { upload: all.filter((d) => d.source === "upload").length, email: all.filter((d) => d.source === "email").length };
  const inbox = all.filter((d) => !d.category).length;
  const activeItem = items.find((i) => i.id === itemId);
  const filterSummary =
    [activeCat?.name, activeItem?.label, source === "upload" ? "Upload" : source === "email" ? "Email" : undefined].filter(Boolean).join(" · ") || "Everything";

  const rail = (
    <>
      <div className="flex flex-col gap-1">
        <RailHeading>Category</RailHeading>
        <RailLink href={href({ category: "" })} active={!category} label="Everything" count={all.length} />
        <RailLink href="/inbox" active={false} label="Inbox" count={inbox} muted />
        {tops.map((t) => (
          <div key={t.id}>
            <RailLink href={href({ category: t.id })} active={category === t.id} label={t.name} count={countTop(t.id)} />
            {activeTop?.id === t.id &&
              kids(t.id).map((c) => <RailLink key={c.id} href={href({ category: c.id })} active={category === c.id} label={c.name} count={c.documentCount} nested />)}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <RailHeading>About</RailHeading>
        <RailLink href={href({ item: "" })} active={!itemId} label="Anything" />
        {/* Same shape as the FOR picker: kinds first, things inside a thing last (spec §6). */}
        {itemGroups(items).map((g) => (
          <div key={g.title}>
            <div className="mt-2 px-3 text-label text-muted">{g.title}</div>
            {g.rows.map((i) => (
              <RailLink key={i.id} href={href({ item: i.id })} active={itemId === i.id} label={i.label} count={i.documentCount} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <RailHeading>Arrived by</RailHeading>
        <RailLink href={href({ source: "" })} active={!source} label="Any" />
        <RailLink href={href({ source: "upload" })} active={source === "upload"} label="Upload" count={bySource.upload} />
        <RailLink href={href({ source: "email" })} active={source === "email"} label="Email" count={bySource.email} />
      </div>
      <div className="flex flex-col px-2.5 lg:gap-1.5 lg:px-0">
        <Link href="/library/categories" className="flex min-h-11 items-center text-body font-medium text-muted hover:text-text lg:block lg:min-h-0 lg:text-small">
          Manage categories
        </Link>
        <Link href="/library/deleted" className="flex min-h-11 items-center text-body font-medium text-muted hover:text-text lg:block lg:min-h-0 lg:text-small">
          Recently deleted
        </Link>
      </div>
    </>
  );

  return (
    <>
      <TopBar />
      <main className="mx-auto flex w-full max-w-[1192px] flex-col gap-6 px-4 pt-2 pb-8 sm:px-8 lg:gap-8 lg:px-14 lg:py-14">
        {/* The top bar has no search box below lg, so on a phone Library carries its own — first,
            because finding a document is what this screen is mostly opened for. */}
        <div className="lg:hidden">
          <LibrarySearchField />
        </div>
        <div>
          <h1 className="text-title font-bold tracking-snug">Library</h1>
          <p className="mt-1.5 text-body text-muted">
            {all.length} document{all.length === 1 ? "" : "s"}
            {inbox ? ` · ${inbox} still in the Inbox` : ""} · search above to look inside them.
          </p>
        </div>

        {/*
          The filters are a rail beside the list where there is room for both, and a disclosure
          above it where there is not — on a phone, forty filter rows stacked over the list would
          put every document a long scroll away. Keyed by the query so choosing a filter closes it
          again and the results are what you see.
        */}
        <details key={params.toString()} className="group rounded-md border border-border xl:hidden">
          <summary className="flex h-12 cursor-pointer list-none items-center gap-2 px-3.5 text-copy lg:h-11 lg:text-row [&::-webkit-details-marker]:hidden">
            <span className="font-semibold">Filters</span>
            <span className="min-w-0 flex-1 truncate text-muted">{filterSummary}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <div className="flex flex-col gap-7 border-t border-border px-2 pt-4 pb-5">{rail}</div>
        </details>

        <div className="flex items-start gap-12">
          <aside className="hidden w-[220px] shrink-0 flex-col gap-7 xl:flex">{rail}</aside>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <h2 className="text-lead font-bold tracking-snug lg:text-section lg:font-semibold">
                {activeCat ? activeCat.name : "Everything"} <span className="text-body font-normal text-muted">· {docs.length}</span>
              </h2>
              <div className="flex items-center gap-2 text-body text-muted lg:text-small">
                Sort
                <select defaultValue={sort} className="h-11 rounded-md border border-border bg-ground px-2 text-body text-text lg:h-8 lg:text-small" name="sort" form="sortform">
                  {SORTS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <form id="sortform" action="/library" className="contents">
                  {category && <input type="hidden" name="category" value={category} />}
                  {itemId && <input type="hidden" name="item" value={itemId} />}
                  {source && <input type="hidden" name="source" value={source} />}
                  <button type="submit" className="h-11 rounded-md border border-border px-3.5 text-body font-medium text-text lg:h-8 lg:px-2.5 lg:text-small">
                    Apply
                  </button>
                </form>
              </div>
            </div>
            {docs.length === 0 && <p className="border-t border-border pt-4 text-body text-muted">Nothing matches these filters.</p>}
            <ul className="flex flex-col">
              {docs.map((d) => (
                <li key={d.id} className="relative flex min-h-14 items-center gap-2 border-t border-border py-3 last:border-b lg:static lg:gap-4 lg:py-2.5 xl:py-0">
                  <ShareTick id={d.id} title={d.title} />
                  {/* One line where the columns fit, two where they do not: the title above where
                      it is filed. The title gives way before the category does at the narrow end
                      of a desktop window, rather than the row running off the side.
                      A phone gets the category's own name rather than its path — "Statements",
                      not "Money › Statements" — so the one line it has left says the most. */}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 xl:flex-row xl:items-center xl:gap-4">
                    <Link href={`/documents/${d.id}`} className="truncate text-copy font-semibold hover:text-accent after:absolute after:inset-0 lg:text-row lg:after:hidden xl:flex-[0_1_340px]">
                      {d.title}
                    </Link>
                    <span className="min-w-0 truncate text-body text-muted lg:text-small xl:flex-1">
                      {d.category ? (
                        <>
                          <span className="lg:hidden">{d.category.name}</span>
                          <span className="hidden lg:inline">{d.category.path}</span>
                        </>
                      ) : (
                        "Inbox"
                      )}
                      {d.items.length ? ` · ${d.items.map((p) => p.label).join(", ")}` : ""}
                    </span>
                  </div>
                  {/* Dates are columns where there is room for columns; the document itself has them. */}
                  <span className="hidden w-24 shrink-0 text-small text-muted lg:block">{d.documentDate ? formatDate(d.documentDate) : ""}</span>
                  <span className="hidden w-32 shrink-0 text-small text-muted lg:block">{d.expiresAt ? `exp. ${formatDate(d.expiresAt)}` : ""}</span>
                  <span className="hidden w-20 shrink-0 text-small text-muted lg:block">{formatRelative(d.createdAt)}</span>
                  <ListStatusPill status={d.file.processingStatus} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </>
  );
}

/** Top-level items grouped by kind, then each parent's children under "In <parent>". */
function itemGroups(items: Item[]): { title: string; rows: Item[] }[] {
  const kinds = [...new Set(items.map((i) => i.kind))].sort(
    (a, b) => ACTIVE_ITEM_KINDS.indexOf(a as never) - ACTIVE_ITEM_KINDS.indexOf(b as never),
  );
  const byKind = kinds
    .map((k) => ({ title: ITEM_KIND_LABEL[k].many, rows: items.filter((i) => i.kind === k && i.parentId === null) }))
    .filter((g) => g.rows.length > 0);
  const nested = new Map<string, Item[]>();
  for (const i of items.filter((i) => i.parentId !== null)) {
    const key = i.parentLabel ?? "Inside";
    nested.set(key, [...(nested.get(key) ?? []), i]);
  }
  return [...byKind, ...[...nested.entries()].map(([parent, rows]) => ({ title: `In ${parent}`, rows }))];
}

function RailLink({ href, active, label, count, nested = false, muted = false }: { href: string; active: boolean; label: string; count?: number; nested?: boolean; muted?: boolean }) {
  return (
    <Link href={href} className={`flex h-11 items-center gap-3 rounded-md px-2.5 text-copy lg:h-8 lg:text-row ${nested ? "ml-4" : ""} ${active ? "bg-accent-soft font-semibold text-accent" : muted ? "text-muted hover:bg-surface" : "text-text hover:bg-surface"}`}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className={`text-body lg:text-small ${active ? "text-accent" : "text-muted"}`}>{count}</span>}
    </Link>
  );
}

/**
 * A filter group's heading: a sentence-case heading on a phone, where an 11px capital label is
 * below what the screen sets (spec §4.2), and the design's `.label` from lg up. Drawn twice rather
 * than restyled at lg: `.label` is a plain class and takes no breakpoint, and `lg:text-label`
 * resolves to the label *colour*, not the 11px size.
 */
function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mb-1 px-2.5 text-copy font-semibold lg:hidden">{children}</div>
      <div className="label mb-1.5 hidden lg:block">{children}</div>
    </>
  );
}

/**
 * The share tick with room around it for a thumb: the box stays the 16px every list draws, the
 * label around it is 32px and tapping anywhere in it ticks. From lg up the label steps out of
 * layout (`contents`) and the checkbox sits in the row exactly as it always has.
 */
function ShareTick({ id, title }: { id: string; title: string }) {
  return (
    <label className="relative z-10 -ml-2 flex size-8 shrink-0 cursor-pointer items-center justify-center lg:contents">
      <ShareCheckbox id={id} title={title} />
    </label>
  );
}

/** "Money › Statements" → "Statements": what a phone row has room to say about where it is filed. */
function ownName(path: string): string {
  return path.split(" › ").at(-1) ?? path;
}

/**
 * Search results, and on a phone the chips that narrow them.
 *
 * The chips filter here rather than in the API: the search endpoint takes a query and nothing
 * else, and a narrowed list is a subset of the one already ranked. A filtered view asks for the
 * endpoint's ceiling (50) instead of the default 20, so "Taxes" shows the Taxes documents among
 * the best fifty rather than among the best twenty. Unfiltered, the request is what it always
 * was, so the desktop list is unchanged.
 */
async function SearchResults({ q, inPath, source }: { q: string; inPath: string; source: string }) {
  const bySource = source === "email" || source === "upload" ? source : "";
  const filtered = Boolean(inPath || bySource);
  const result = await apiFetch<SearchResponse>(`/search?q=${encodeURIComponent(q)}${filtered ? "&limit=50" : ""}`);
  const hits = result.hits.filter((h) => (!inPath || h.categoryPath === inPath) && (!bySource || h.source === bySource));
  const shown = filtered ? hits.length : result.total;

  // Chips are drawn from every hit, not the narrowed ones, so choosing one leaves the others there
  // to choose instead. A category that holds every hit would only repeat "All"; a name shared by
  // two categories falls back to its path so the two chips can be told apart.
  const paths = [...new Set(result.hits.map((h) => h.categoryPath).filter((p): p is string => p !== null))].filter(
    (p) => result.hits.some((h) => h.categoryPath !== p),
  );
  const names = paths.map(ownName);
  const sources = (["email", "upload"] as const).filter((s) => result.hits.some((h) => h.source === s));
  const chipHref = (patch: { in?: string; source?: string }) => {
    const p = new URLSearchParams({ q });
    if (patch.in) p.set("in", patch.in);
    if (patch.source) p.set("source", patch.source);
    return `/library?${p}`;
  };
  const chips = [
    { key: "all", label: `All ${result.total}`, href: chipHref({}), on: !filtered },
    ...paths.map((p, i) => ({
      key: `in:${p}`,
      label: names.indexOf(names[i]!) === names.lastIndexOf(names[i]!) ? names[i]! : p,
      href: chipHref({ in: p }),
      on: inPath === p,
    })),
    ...(sources.length === 2
      ? sources.map((s) => ({ key: `source:${s}`, label: s === "email" ? "Email" : "Upload", href: chipHref({ source: s }), on: bySource === s }))
      : []),
  ];

  return (
    <>
      <TopBar query={q} />
      {/* Below lg the screen is the field, the chips, a count and the rows, set close together the
          way the design has them; from lg up it is the spaced page it has always been. */}
      <main className="mx-auto flex w-full max-w-[1192px] flex-col px-4 pt-2 pb-8 sm:px-8 lg:gap-8 lg:px-14 lg:py-14">
        <div className="lg:hidden">
          <LibrarySearchField key={q} query={q} />
        </div>
        <div className="hidden lg:block">
          <h1 className="text-title font-bold tracking-snug">Library</h1>
          <p className="mt-1.5 text-body text-muted">Every document in the vault, including the words inside them.</p>
        </div>
        {chips.length > 1 && (
          // Scrolls sideways edge to edge rather than wrapping: a second row of chips would push
          // the first result below the fold on a phone.
          <nav aria-label="Narrow the results" className="scrollbar-none -mx-4 mt-3.5 flex gap-2 overflow-x-auto px-4 sm:-mx-8 sm:px-8 lg:hidden">
            {chips.map((c) => (
              <Link
                key={c.key}
                href={c.href}
                aria-current={c.on ? "page" : undefined}
                className={`flex h-11 shrink-0 items-center rounded-pill px-4 text-[16px] font-semibold whitespace-nowrap ${c.on ? "bg-text text-ground" : "border border-border-strong text-text"}`}
              >
                {c.label}
              </Link>
            ))}
          </nav>
        )}
        {/* A phone gets the count and nothing else: the timing is for someone at a desk wondering
            whether search is slow. */}
        <p className="mt-5 text-body text-muted lg:hidden">
          {shown} result{shown === 1 ? "" : "s"}
          {result.fuzzy && " · closest spelling"}
        </p>
        <div className="hidden flex-wrap items-baseline justify-between gap-x-4 gap-y-2 lg:flex">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h2 className="text-section font-semibold tracking-snug">
              {shown} result{shown === 1 ? "" : "s"} for &ldquo;{q}&rdquo;
            </h2>
            <span className="text-small text-muted">{result.tookMs} ms</span>
            {result.fuzzy && <span className="rounded-pill bg-warn-soft px-2.5 py-0.5 text-label font-semibold text-warn">closest spelling</span>}
          </div>
          <Link href="/library" className="text-row font-medium text-accent">
            Clear search
          </Link>
        </div>
        {result.fuzzy && (
          <p className="mt-2 text-body text-muted lg:mt-0">
            Nothing contains those words exactly, so these are the closest by spelling.
          </p>
        )}
        {hits.length === 0 && (
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-5 lg:mt-0">
            <p className="text-body">Nothing matches &ldquo;{q}&rdquo;.</p>
            <p className="max-w-[560px] text-body text-muted">
              Search covers titles, notes, tags, the people and things a document is about, and every word read off
              the page — in German and English, and it forgives a typo or two. If the document is new it may still be
              processing; the Inbox shows what is in flight.
            </p>
            <div className="mt-1 flex gap-4 text-copy font-medium text-accent lg:text-row">
              <Link href="/library" className="flex min-h-11 items-center lg:block lg:min-h-0">Browse everything</Link>
              <Link href="/inbox" className="flex min-h-11 items-center lg:block lg:min-h-0">Check the Inbox</Link>
            </div>
          </div>
        )}
        {/* Below lg the title's link is stretched over its whole row (`after:inset-0`), so a thumb
            anywhere on a result opens it; the share tick sits above it. From lg up the title is
            the link again and View stands beside it. */}
        <ul className="mt-1 flex flex-col lg:mt-0">
          {hits.map((h) => (
            <li key={h.documentId} className="relative flex items-start gap-2 border-b border-border py-4 lg:static lg:gap-4 lg:border-t lg:border-b-0 lg:last:border-b">
              <span className="-mt-[5px] flex lg:mt-1 lg:h-[22px] lg:items-center">
                <ShareTick id={h.documentId} title={h.title} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-col gap-1.5 lg:flex-row lg:flex-wrap lg:items-baseline lg:gap-x-2.5 lg:gap-y-0.5">
                  <Link href={`/documents/${h.documentId}`} className="text-copy font-semibold hover:text-accent after:absolute after:inset-0 lg:text-row lg:after:hidden">
                    {h.title}
                  </Link>
                  {/* One line on a phone — where it is filed, by its own name, and the year. */}
                  <span className="text-body text-muted lg:hidden">
                    {h.categoryPath ? ownName(h.categoryPath) : "Inbox"}
                    {h.documentDate ? ` · ${h.documentDate.slice(0, 4)}` : ""}
                  </span>
                  <span className="hidden text-small text-muted lg:inline">
                    {h.categoryPath ?? "Inbox"} · {h.documentDate ? formatDate(h.documentDate) : "no date yet"}
                  </span>
                </div>
                <Snippet html={h.snippetHtml} />
                {/*
                  Labels get their own fill (`label`, green), never the accent: the accent fill is
                  what the snippet uses for a matched word, and a person or tag drawn the same way
                  reads as a match it is not. Items stay links and say so on hover.
                  Not on a phone, where they would take a row of their own under every result;
                  the document lists who and what it is about one tap away.
                */}
                <div className="mt-0.5 hidden flex-wrap items-center gap-1.5 lg:flex">
                  {h.items.map((i) => (
                    <Link
                      key={i.id}
                      href={`/items/${i.id}`}
                      title={ITEM_KIND_LABEL[i.kind as keyof typeof ITEM_KIND_LABEL]?.one ?? i.kind}
                      className="rounded-sm bg-label-soft px-2 py-0.5 text-small font-medium text-label hover:underline"
                    >
                      {i.label}
                    </Link>
                  ))}
                  {h.tags.map((t) => (
                    <span key={t} className="rounded-sm bg-label-soft px-2 py-0.5 text-small font-medium text-label">
                      {t}
                    </span>
                  ))}
                  {/* How it arrived, as one more label rather than a column of its own: the row's right edge is for View alone. */}
                  <span className="rounded-sm bg-label-soft px-2 py-0.5 text-small font-medium text-label">{h.source === "email" ? "Email" : "Upload"}</span>
                </div>
              </div>
              <Link
                href={`/documents/${h.documentId}`}
                // The title is already the link; below lg the snippet needs this width more.
                className="hidden h-8 shrink-0 items-center self-center rounded-md border border-border px-3 text-small font-medium text-text hover:border-accent hover:text-accent lg:flex"
              >
                View
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
