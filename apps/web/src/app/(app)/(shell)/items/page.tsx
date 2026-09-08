import type { Metadata } from "next";
import Link from "next/link";
import { ACTIVE_ITEM_KINDS, ITEM_KIND_LABEL, itemSubtitle, type Item } from "@harbor/shared";
import { TopBar } from "@/components/shell/TopBar";
import { EmptyState } from "@/components/EmptyState";
import { apiFetch } from "@/lib/api-server";
import { ItemAvatar } from "@/components/ItemAvatar";
import { ItemForm } from "./ItemForm";

export const metadata: Metadata = { title: "People & things" };

export default async function ItemsPage() {
  const items = await apiFetch<Item[]>("/items");
  const parents = items.filter((i) => i.kind !== "person");

  return (
    <>
      <TopBar />
      <main className="flex max-w-[1192px] flex-col gap-12 px-14 py-14">
        <div>
          <h1 className="text-title font-bold tracking-snug">People &amp; things</h1>
          <p className="mt-1.5 text-body text-muted">
            Everything documents can be <em>about</em> — family members, the house, the car, an account. Suggestions can only pick from this list.
          </p>
        </div>

        {items.length === 0 && (
          <EmptyState
            title="Nothing to file documents against yet"
            body="Add the people in your household and the things that generate paperwork — the house, the car, an account. Suggestions can only pick from this list, so a document about the house can only be marked as such once the house exists."
          />
        )}

        {ACTIVE_ITEM_KINDS.map((kind) => {
          const inKind = items.filter((i) => i.kind === kind && i.parentId === null);
          return (
            <section key={kind} className="flex flex-col gap-4">
              <h2 className="text-section font-bold tracking-snug">{ITEM_KIND_LABEL[kind].many}</h2>
              <div className="grid grid-cols-4 gap-4">
                {inKind.map((i) => (
                  <ItemCard key={i.id} item={i} inside={items.filter((c) => c.parentId === i.id)} />
                ))}
                <ItemForm kind={kind} parents={parents} />
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}

function ItemCard({ item, inside }: { item: Item; inside: Item[] }) {
  const subtitle = itemSubtitle(item);
  return (
    <Link href={`/items/${item.id}`} className="flex min-h-[220px] flex-col items-center gap-1 rounded-card border border-border px-4 py-7 text-center hover:bg-surface">
      <div className="mb-3"><ItemAvatar item={item} size={76} textSize="text-[26px]" /></div>
      <div className="text-section font-semibold tracking-snug">{item.label}</div>
      <div className="line-clamp-2 text-small text-muted">{subtitle ?? "—"}</div>
      <div className="mt-1 text-row text-muted">
        {item.documentCount} record{item.documentCount === 1 ? "" : "s"}
      </div>
      {inside.length > 0 && (
        <div className="mt-auto pt-3 text-label text-muted">
          {inside.length} inside: {inside.map((c) => c.label).join(", ")}
        </div>
      )}
    </Link>
  );
}
