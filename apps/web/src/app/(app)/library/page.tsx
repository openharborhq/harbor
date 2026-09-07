import type { Metadata } from "next";
import Link from "next/link";
import { ACTIVE_ITEM_KINDS, ITEM_KIND_LABEL, type Category, type DocumentSummary, type Item, type SearchResponse } from "@trustworthier/shared";
import { Snippet } from "@/components/Snippet";
import { DocThumb } from "@/components/DocThumb";
import { StatusPill } from "@/components/StatusPill";
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

  if (q) return <SearchResults q={q} />;

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

  return (
    <>
      <TopBar />
      <main className="flex max-w-[1192px] flex-col gap-8 px-14 py-14">
        <div>
          <h1 className="text-title font-bold tracking-snug">Library</h1>
          <p className="mt-1.5 text-body text-muted">
            {all.length} document{all.length === 1 ? "" : "s"}
            {inbox ? ` · ${inbox} still in the Inbox` : ""} · search above to look inside them.
          </p>
        </div>

        <div className="flex items-start gap-12">
          <aside className="flex w-[220px] shrink-0 flex-col gap-7">
            <div className="flex flex-col gap-1">
              <div className="label mb-1.5">Category</div>
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
              <div className="label mb-1.5">About</div>
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
              <div className="label mb-1.5">Arrived by</div>
              <RailLink href={href({ source: "" })} active={!source} label="Any" />
              <RailLink href={href({ source: "upload" })} active={source === "upload"} label="Upload" count={bySource.upload} />
              <RailLink href={href({ source: "email" })} active={source === "email"} label="Email" count={bySource.email} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Link href="/library/categories" className="text-small font-medium text-muted hover:text-text">
                Manage categories
              </Link>
              <Link href="/library/deleted" className="text-small font-medium text-muted hover:text-text">
                Recently deleted
              </Link>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-section font-semibold tracking-snug">
                {activeCat ? activeCat.name : "Everything"} <span className="text-body font-normal text-muted">· {docs.length}</span>
              </h2>
              <div className="flex items-center gap-2 text-small text-muted">
                Sort
                <select defaultValue={sort} className="h-8 rounded-md border border-border bg-ground px-2 text-small text-text" name="sort" form="sortform">
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
                  <button type="submit" className="h-8 rounded-md border border-border px-2.5 text-small font-medium text-text">
                    Apply
                  </button>
                </form>
              </div>
            </div>
            {docs.length === 0 && <p className="border-t border-border pt-4 text-body text-muted">Nothing matches these filters.</p>}
            <ul className="flex flex-col">
              {docs.map((d) => (
                <li key={d.id} className="flex h-14 items-center gap-4 border-t border-border last:border-b">
                  <DocThumb documentId={d.id} hasThumbnail={d.file.hasThumbnail} version={d.file.version} width={30} height={38} className="rounded-sm" />
                  <Link href={`/documents/${d.id}`} className="w-[340px] truncate text-row font-semibold hover:text-accent">
                    {d.title}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-small text-muted">
                    {d.category ? d.category.path : "Inbox"}
                    {d.items.length ? ` · ${d.items.map((p) => p.label).join(", ")}` : ""}
                  </span>
                  <span className="w-24 shrink-0 text-small text-muted">{d.documentDate ? formatDate(d.documentDate) : ""}</span>
                  <span className="w-32 shrink-0 text-small text-muted">{d.expiresAt ? `exp. ${formatDate(d.expiresAt)}` : ""}</span>
                  <span className="w-20 shrink-0 text-small text-muted">{formatRelative(d.createdAt)}</span>
                  <StatusPill status={d.file.processingStatus} />
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
    <Link href={href} className={`flex h-8 items-center gap-3 rounded-md px-2.5 text-row ${nested ? "ml-4" : ""} ${active ? "bg-accent-soft font-semibold text-accent" : muted ? "text-muted hover:bg-surface" : "text-text hover:bg-surface"}`}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className={`text-small ${active ? "text-accent" : "text-muted"}`}>{count}</span>}
    </Link>
  );
}

async function SearchResults({ q }: { q: string }) {
  const result = await apiFetch<SearchResponse>(`/search?q=${encodeURIComponent(q)}`);
  return (
    <>
      <TopBar query={q} />
      <main className="flex max-w-[1192px] flex-col gap-8 px-14 py-14">
        <div>
          <h1 className="text-title font-bold tracking-snug">Library</h1>
          <p className="mt-1.5 text-body text-muted">Every document in the vault, including the words inside them.</p>
        </div>
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-section font-semibold tracking-snug">
              {result.total} result{result.total === 1 ? "" : "s"} for &ldquo;{q}&rdquo;
            </h2>
            <span className="text-small text-muted">{result.tookMs} ms</span>
            {result.fuzzy && <span className="rounded-pill bg-warn-soft px-2.5 py-0.5 text-label font-semibold text-warn">closest spelling</span>}
          </div>
          <Link href="/library" className="text-row font-medium text-accent">
            Clear search
          </Link>
        </div>
        {result.fuzzy && (
          <p className="text-body text-muted">
            Nothing contains those words exactly, so these are the closest by spelling.
          </p>
        )}
        {result.hits.length === 0 && (
          <div className="flex flex-col gap-2 border-t border-border pt-5">
            <p className="text-body">Nothing matches &ldquo;{q}&rdquo;.</p>
            <p className="max-w-[560px] text-body text-muted">
              Search covers titles, notes, tags, the people and things a document is about, and every word read off
              the page — in German and English, and it forgives a typo or two. If the document is new it may still be
              processing; the Inbox shows what is in flight.
            </p>
            <div className="mt-1 flex gap-4 text-row font-medium text-accent">
              <Link href="/library">Browse everything</Link>
              <Link href="/inbox">Check the Inbox</Link>
            </div>
          </div>
        )}
        <ul className="flex flex-col">
          {result.hits.map((h) => (
            <li key={h.documentId} className="flex items-start gap-4 border-t border-border py-4 last:border-b">
              <div className="h-14 w-11 shrink-0 rounded-sm border border-border bg-surface" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-baseline gap-2.5">
                  <Link href={`/documents/${h.documentId}`} className="text-row font-semibold hover:text-accent">
                    {h.title}
                  </Link>
                  <span className="text-small text-muted">
                    {h.categoryPath ?? "Inbox"} · {h.documentDate ? formatDate(h.documentDate) : "no date yet"}
                  </span>
                </div>
                <Snippet html={h.snippetHtml} />
              </div>
              <span className="w-24 shrink-0 text-right text-small text-muted">{h.source === "email" ? "Email" : "Upload"}</span>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}

