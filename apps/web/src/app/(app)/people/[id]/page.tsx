import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { DocumentSummary, KeyDocumentSlot, Person } from "@trustworthier/shared";
import { StatusPill } from "@/components/StatusPill";
import { TopBar } from "@/components/shell/TopBar";
import { ApiError, apiFetch } from "@/lib/api-server";
import { ageFrom, formatDate, formatRelative } from "@/lib/format";
import { KeyDocuments } from "./KeyDocuments";

export const metadata: Metadata = { title: "Family member" };

export default async function PersonPage(props: PageProps<"/people/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const filter = typeof sp.category === "string" ? sp.category : "";
  let data: { person: Person; keyDocuments: KeyDocumentSlot[]; documents: DocumentSummary[] };
  try {
    data = await apiFetch(`/people/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const { person, keyDocuments, documents } = data;
  const topOf = (d: DocumentSummary) => d.category?.path.split(" › ")[0] ?? "Inbox";
  const counts = new Map<string, number>();
  for (const d of documents) counts.set(topOf(d), (counts.get(topOf(d)) ?? 0) + 1);
  const shown = filter ? documents.filter((d) => topOf(d) === filter) : documents;
  const age = person.dateOfBirth ? ageFrom(person.dateOfBirth) : null;

  return (
    <>
      <TopBar />
      <main className="flex max-w-[1192px] flex-col gap-12 px-14 py-14">
        <div className="flex items-center gap-6">
          <div className="flex size-[88px] items-center justify-center rounded-pill bg-surface text-[32px] font-semibold text-muted">{person.displayName.slice(0, 1)}</div>
          <div>
            <Link href="/people" className="text-small font-medium text-accent">
              ← People
            </Link>
            <h1 className="mt-1 text-title font-bold tracking-snug">{person.displayName}</h1>
            <p className="mt-1 text-body text-muted">
              {[person.relationship, person.dateOfBirth ? `born ${formatDate(person.dateOfBirth)}${age !== null ? ` · ${age} years old` : ""}` : null, `${person.documentCount} record${person.documentCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline gap-3">
            <h2 className="text-section font-bold tracking-snug">Key documents</h2>
            <span className="text-body text-muted">the ones you need in a hurry</span>
          </div>
          <KeyDocuments personId={person.id} slots={keyDocuments} candidates={documents.map((d) => ({ id: d.id, title: d.title }))} />
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-section font-bold tracking-snug">All records</h2>
            <div className="flex gap-1.5">
              <Chip href={`/people/${person.id}`} active={!filter} label={`All ${documents.length}`} />
              {[...counts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => (
                  <Chip key={name} href={`/people/${person.id}?category=${encodeURIComponent(name)}`} active={filter === name} label={`${name} ${n}`} />
                ))}
            </div>
          </div>
          {shown.length === 0 && <p className="border-t border-border pt-4 text-body text-muted">No records yet. Upload something and set FOR to {person.displayName}, or accept a suggestion that names {person.displayName}.</p>}
          <ul className="flex flex-col">
            {shown.map((d) => (
              <li key={d.id} className="flex h-14 items-center gap-4 border-t border-border last:border-b">
                <div className="h-[38px] w-[30px] shrink-0 rounded-sm border border-border bg-surface" />
                <Link href={`/documents/${d.id}`} className="w-[380px] truncate text-row font-semibold hover:text-accent">
                  {d.title}
                </Link>
                <span className="flex-1 truncate text-small text-muted">{d.category?.path ?? "Inbox"}</span>
                <span className="w-28 shrink-0 text-small text-muted">{d.documentDate ? formatDate(d.documentDate) : "—"}</span>
                <span className="w-28 shrink-0 text-small text-muted">{d.expiresAt ? `exp. ${formatDate(d.expiresAt)}` : ""}</span>
                <span className="w-20 shrink-0 text-small text-muted">{formatRelative(d.createdAt)}</span>
                <StatusPill status={d.file.processingStatus} />
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

function Chip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} className={`h-7 rounded-pill px-3 text-small font-medium leading-7 ${active ? "bg-text text-white" : "bg-surface text-muted hover:text-text"}`}>
      {label}
    </Link>
  );
}
