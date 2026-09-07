import type { Metadata } from "next";
import Link from "next/link";
import type { DeletedDocument } from "@trustworthier/shared";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";
import { formatRelative } from "@/lib/format";
import { RestoreButton } from "./RestoreButton";

export const metadata: Metadata = { title: "Recently deleted" };

export default async function DeletedPage() {
  const docs = await apiFetch<DeletedDocument[]>("/documents/deleted");
  return (
    <>
      <TopBar />
      <main className="flex max-w-[1192px] flex-col gap-8 px-14 py-14">
        <div>
          <Link href="/library" className="text-small font-medium text-accent">
            ← Library
          </Link>
          <h1 className="mt-2 text-title font-bold tracking-snug">Recently deleted</h1>
          <p className="mt-1.5 text-body text-muted">Deleted documents stay here, encrypted, until they are purged. Restore puts them back exactly as they were.</p>
        </div>
        {docs.length === 0 && <p className="text-body text-muted">Nothing here.</p>}
        <ul className="flex flex-col">
          {docs.map((d) => (
            <li key={d.id} className="flex h-14 items-center gap-4 border-t border-border last:border-b">
              <div className="h-[38px] w-[30px] shrink-0 rounded-sm border border-border bg-surface" />
              <span className="w-[420px] truncate text-row font-semibold">{d.title}</span>
              <span className="flex-1 truncate text-small text-muted">
                {d.categoryPath ?? "Inbox"} · {d.originalFilename} · deleted {formatRelative(d.deletedAt)}
              </span>
              <RestoreButton id={d.id} />
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
