import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ITEM_KIND_LABEL, itemSubtitle, type DocumentSummary, type Item, type KeyDocumentSlot } from "@trustworthier/shared";
import { DocThumb } from "@/components/DocThumb";
import { StatusPill } from "@/components/StatusPill";
import { TopBar } from "@/components/shell/TopBar";
import { ApiError, apiFetch } from "@/lib/api-server";
import { ageFrom, formatDate, formatRelative } from "@/lib/format";
import { itemGlyph } from "@/lib/item-glyph";
import { DeleteItem } from "./DeleteItem";
import { ItemNotes } from "./ItemNotes";
import { KeyDocuments } from "./KeyDocuments";

export const metadata: Metadata = { title: "Item" };

export default async function ItemPage(props: PageProps<"/items/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const filter = typeof sp.category === "string" ? sp.category : "";
  let data: { item: Item; children: Item[]; keyDocuments: KeyDocumentSlot[]; documents: DocumentSummary[] };
  try {
    data = await apiFetch(`/items/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const { item, children, keyDocuments, documents } = data;
  const topOf = (d: DocumentSummary) => d.category?.path.split(" › ")[0] ?? "Inbox";
  const counts = new Map<string, number>();
  for (const d of documents) counts.set(topOf(d), (counts.get(topOf(d)) ?? 0) + 1);
  const shown = filter ? documents.filter((d) => topOf(d) === filter) : documents;

  return (
    <>
      <TopBar />
      <main className="flex max-w-[1192px] flex-col gap-12 px-14 py-14">
        <div className="flex items-center gap-6">
          <div className="flex size-[88px] items-center justify-center rounded-pill bg-surface text-[32px] font-semibold text-muted">{itemGlyph(item.kind, item.label)}</div>
          <div>
            <div className="flex items-center gap-2 text-small font-medium">
              <Link href="/items" className="text-accent">
                ← People &amp; things
              </Link>
              {item.parentId && (
                <>
                  <span className="text-muted">/</span>
                  <Link href={`/items/${item.parentId}`} className="text-accent">
                    {item.parentLabel}
                  </Link>
                </>
              )}
            </div>
            <h1 className="mt-1 text-title font-bold tracking-snug">{item.label}</h1>
            <p className="mt-1 text-body text-muted">{headline(item)}</p>
          </div>
        </div>

        <ItemNotes item={item} />

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline gap-3">
            <h2 className="text-section font-bold tracking-snug">Key documents</h2>
            <span className="text-body text-muted">the ones you need in a hurry</span>
          </div>
          <KeyDocuments itemId={item.id} slots={keyDocuments} candidates={documents.map((d) => ({ id: d.id, title: d.title }))} />
        </section>

        {children.length > 0 && (
          <section className="flex flex-col gap-4">
            <div className="flex items-baseline gap-3">
              <h2 className="text-section font-bold tracking-snug">Inside {item.label}</h2>
              <span className="text-body text-muted">their records count towards this page too</span>
            </div>
            <div className="grid grid-cols-4 gap-4">
              {children.map((c) => (
                <Link key={c.id} href={`/items/${c.id}`} className="flex flex-col gap-1 rounded-card border border-border p-4 hover:bg-surface">
                  <div className="label">{ITEM_KIND_LABEL[c.kind].one}</div>
                  <div className="text-row font-semibold">{c.label}</div>
                  <div className="text-small text-muted">
                    {itemSubtitle(c) ?? `${c.documentCount} record${c.documentCount === 1 ? "" : "s"}`}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-section font-bold tracking-snug">All records</h2>
            <div className="flex gap-1.5">
              <Chip href={`/items/${item.id}`} active={!filter} label={`All ${documents.length}`} />
              {[...counts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => (
                  <Chip key={name} href={`/items/${item.id}?category=${encodeURIComponent(name)}`} active={filter === name} label={`${name} ${n}`} />
                ))}
            </div>
          </div>
          {shown.length === 0 && (
            <p className="border-t border-border pt-4 text-body text-muted">
              No records yet. Upload something and set FOR to {item.label}, or accept a suggestion that names {item.label}.
            </p>
          )}
          <ul className="flex flex-col">
            {shown.map((d) => (
              <li key={d.id} className="flex h-14 items-center gap-4 border-t border-border last:border-b">
                <DocThumb documentId={d.id} hasThumbnail={d.file.hasThumbnail} version={d.file.version} width={30} height={38} className="rounded-sm" />
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

        <section className="border-t border-border pt-6">
          <DeleteItem item={item} documentCount={documents.length} childCount={children.length} />
        </section>
      </main>
    </>
  );
}

function headline(item: Item): string {
  const bits: (string | null)[] = [ITEM_KIND_LABEL[item.kind].one, itemSubtitle(item)];
  const dob = item.details.dateOfBirth;
  if (item.kind === "person" && typeof dob === "string" && dob) {
    const age = ageFrom(dob);
    bits.push(`born ${formatDate(dob)}${age !== null ? ` · ${age} years old` : ""}`);
  }
  bits.push(`${item.documentCount} record${item.documentCount === 1 ? "" : "s"}`);
  return bits.filter(Boolean).join(" · ");
}

function Chip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} className={`h-7 rounded-pill px-3 text-small font-medium leading-7 ${active ? "bg-text text-white" : "bg-surface text-muted hover:text-text"}`}>
      {label}
    </Link>
  );
}
