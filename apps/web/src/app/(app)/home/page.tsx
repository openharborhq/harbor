import type { Metadata } from "next";
import Link from "next/link";
import type { HomeData } from "@trustworthier/shared";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";
import { formatDate, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const h = await apiFetch<HomeData>("/home");
  const tops = h.categories.filter((c) => c.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
  const children = (id: string) => h.categories.filter((c) => c.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder);
  const countOf = (id: string) => (h.categories.find((c) => c.id === id)?.documentCount ?? 0) + children(id).reduce((n, c) => n + c.documentCount, 0);
  const totalRecords = h.family.reduce((n, p) => n + p.documentCount, 0);

  return (
    <>
      <TopBar />
      <main className="flex max-w-[1192px] flex-col gap-16 px-14 py-14">
        {/* Family */}
        <section className="flex flex-col gap-5">
          <SectionHeader title="Family" meta={`${h.family.length} ${h.family.length === 1 ? "person" : "people"} · ${totalRecords} records`} />
          <div className="grid grid-cols-4 gap-6">
            {h.family.map((p) => (
              <Link key={p.id} href={`/people/${p.id}`} className="flex flex-col items-center gap-1 rounded-card border border-border px-4 py-7 text-center hover:bg-surface">
                <div className="mb-3 flex size-[76px] items-center justify-center rounded-pill bg-surface text-[26px] font-semibold text-muted">{p.displayName.slice(0, 1)}</div>
                <div className="text-section font-semibold tracking-snug">{p.displayName}</div>
                <div className="text-body text-muted">
                  {p.documentCount} record{p.documentCount === 1 ? "" : "s"}
                </div>
                <div className={`text-row ${p.next ? (p.next.daysLeft <= 30 ? "font-medium text-warn" : "text-text") : "text-muted"}`}>
                  {p.next ? (p.next.daysLeft <= 0 ? "Expired" : `Expires in ${p.next.daysLeft} days`) : "Nothing expiring"}
                </div>
              </Link>
            ))}
            {h.family.length === 0 && (
              <Link href="/people" className="flex min-h-[200px] flex-col items-center justify-center rounded-card border border-dashed border-border-strong text-row font-medium text-muted">
                + Add your family
              </Link>
            )}
          </div>
        </section>

        {/* Categories */}
        <section className="flex flex-col gap-5">
          <SectionHeader title="Categories" meta={`${tops.length} categories · ${h.totalDocuments} documents`} />
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
                  <div className="w-24 shrink-0 truncate text-row">{d.people.join(", ") || "—"}</div>
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
