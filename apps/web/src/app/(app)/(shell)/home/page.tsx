import type { Metadata } from "next";
import Link from "next/link";
import type { HomeData } from "@harbor/shared";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";
import { formatDate, formatRelative } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { ItemAvatar } from "@/components/ItemAvatar";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const h = await apiFetch<HomeData>("/home");
  const backupNote =
    h.backup.state === "ok" && h.backup.at
      ? `backed up ${formatRelative(h.backup.at).toLowerCase()}`
      : h.backup.state === "failed"
        ? "last backup failed"
        : h.backup.state === "never"
          ? "never backed up"
          : "no backups configured";
  const tops = h.categories.filter((c) => c.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
  const children = (id: string) => h.categories.filter((c) => c.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder);
  const countOf = (id: string) => (h.categories.find((c) => c.id === id)?.documentCount ?? 0) + children(id).reduce((n, c) => n + c.documentCount, 0);
  const totalRecords = h.family.reduce((n, p) => n + p.documentCount, 0);
  const thingRecords = h.things.reduce((n, t) => n + t.documentCount, 0);

  return (
    <>
      <TopBar />
      <main className="flex max-w-[1192px] flex-col gap-16 px-14 py-14">
        {/* Family */}
        <section className="flex flex-col gap-5">
          <SectionHeader title="Family" meta={`${plural(h.family.length, "person", "people")} · ${plural(totalRecords, "record")}`} />
          <div className="grid grid-cols-4 gap-6">
            {h.family.map((p) => (
              <ItemCard key={p.id} item={p} />
            ))}
            {h.family.length === 0 && (
              <Link href="/items" className="flex min-h-[200px] flex-col items-center justify-center rounded-card border border-dashed border-border-strong text-row font-medium text-muted">
                + Add your family
              </Link>
            )}
          </div>
        </section>

        {/* Property & things */}
        <section className="flex flex-col gap-5">
          <SectionHeader title="Property &amp; things" meta={`${plural(h.things.length, "item")} · ${plural(thingRecords, "record")}`} />
          <div className="grid grid-cols-4 gap-6">
            {h.things.map((t) => (
              <ItemCard key={t.id} item={t} />
            ))}
            <Link href="/items" className="flex min-h-[200px] flex-col items-center justify-center rounded-card border border-dashed border-border-strong text-row font-medium text-muted hover:text-text">
              + Add a house, car or account
            </Link>
          </div>
        </section>

        {/* Categories */}
        <section className="flex flex-col gap-5">
          <SectionHeader title="Categories" meta={`${tops.length} categories · ${h.totalDocuments} documents · ${backupNote}`} />
          <div className="grid grid-cols-4 gap-4">
            {tops.map((c) => (
              <Link key={c.id} href={`/library?category=${c.id}`} className="flex flex-col gap-2 rounded-lg border border-border px-5 py-4 hover:bg-surface">
                <div className="flex items-center justify-between">
                  <span className="text-row font-semibold">{c.name}</span>
                  <span className="text-row text-muted">{countOf(c.id)}</span>
                </div>
                <div className="truncate text-small text-muted">{children(c.id).map((s) => s.name).join(" · ") || "—"}</div>
              </Link>
            ))}
            <Link href="/library" className="flex min-h-[74px] items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-row font-medium text-muted hover:text-text">
              + New category
            </Link>
          </div>
        </section>

        <div className="grid grid-cols-[1.6fr_1fr] gap-12">
          {/* Expiring soon */}
          <section className="flex flex-col gap-4">
            <SectionHeader title="Expiring soon" meta="next 90 days" small />
            {h.expiringSoon.length === 0 && <p className="border-t border-border pt-4 text-body text-muted">Nothing expires in the next 90 days — or nothing has an expiry date yet. Suggestions fill those in from bills, policies and passports.</p>}
            <ul className="flex flex-col">
              {h.expiringSoon.map((d) => (
                <li key={d.documentId} className="flex h-[70px] items-center gap-4 border-t border-border last:border-b">
                  <DocIcon />
                  <div className="min-w-0 flex-1">
                    <Link href={`/documents/${d.documentId}`} className="block truncate text-row font-semibold hover:text-accent">
                      {d.title}
                    </Link>
                    <div className="truncate text-small text-muted">{d.categoryPath ?? "Inbox"}</div>
                  </div>
                  <div className="w-24 shrink-0 truncate text-row">{d.items.join(", ") || "—"}</div>
                  <div className="w-28 shrink-0 text-row">{formatDate(d.expiresAt)}</div>
                  <span className={`inline-flex h-[22px] shrink-0 items-center rounded-pill px-2.5 text-label font-semibold ${d.daysLeft <= 30 ? "bg-warn-soft text-warn" : "bg-surface text-muted"}`}>
                    {d.daysLeft <= 0 ? "today" : `${d.daysLeft} days`}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Recently added */}
          <section className="flex flex-col gap-4">
            <SectionHeader title="Recently added" small />
            {h.recentlyAdded.length === 0 && (
              <EmptyState
                compact
                title="Nothing in the vault yet"
                body="Drop a bill, a passport scan or a policy on the Add page. Everything is read, indexed and suggested a home in about a minute."
                action="Add documents"
                href="/add"
              />
            )}
            <ul className="flex flex-col">
              {h.recentlyAdded.map((d) => (
                <li key={d.documentId} className="flex h-[70px] items-center gap-3.5 border-t border-border last:border-b">
                  <div className="h-10 w-8 shrink-0 rounded-sm border border-border bg-surface" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/documents/${d.documentId}`} className="block truncate text-row font-semibold hover:text-accent">
                      {d.title}
                    </Link>
                    <div className={`truncate text-small ${d.needsFiling ? "font-medium text-accent" : "text-muted"}`}>
                      {d.source === "email" ? "Email" : "Upload"} · {d.needsFiling ? "needs filing" : d.categoryPath}
                    </div>
                  </div>
                  <div className="shrink-0 text-small text-muted">{formatRelative(d.createdAt)}</div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}

/** One tile in Family or Property & things — the same card, since both are items (spec §6). */
function ItemCard({ item }: { item: HomeData["family"][number] }) {
  return (
    <Link href={`/items/${item.id}`} className="flex flex-col items-center gap-1 rounded-card border border-border px-4 py-7 text-center hover:bg-surface">
      <div className="mb-3">
        <ItemAvatar item={item} size={76} textSize="text-[26px]" />
      </div>
      <div className="text-section font-semibold tracking-snug">{item.label}</div>
      {item.subtitle && <div className="line-clamp-1 text-small text-muted">{item.subtitle}</div>}
      <div className="text-body text-muted">
        {item.documentCount} record{item.documentCount === 1 ? "" : "s"}
      </div>
      <div className={`text-row ${item.next ? (item.next.daysLeft <= 30 ? "font-medium text-warn" : "text-text") : "text-muted"}`}>
        {item.next ? (item.next.daysLeft <= 0 ? "Expired" : `Expires in ${item.next.daysLeft} days`) : "Nothing expiring"}
      </div>
    </Link>
  );
}

/** "1 record", "2 records" — the counts here are routinely 1. */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function SectionHeader({ title, meta, small = false }: { title: string; meta?: string; small?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className={`${small ? "text-section" : "text-[26px] leading-8"} font-bold tracking-snug`}>{title}</h2>
      {meta && <span className="text-body text-muted">{meta}</span>}
    </div>
  );
}

function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}
