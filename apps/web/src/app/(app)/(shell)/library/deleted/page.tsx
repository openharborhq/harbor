import type { Metadata } from "next";
import type { DeletedDocument } from "@harbor/shared";
import { EmptyState } from "@/components/EmptyState";
import { BackLink } from "@/components/BackLink";
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
      <main className="mx-auto flex w-full max-w-[1192px] flex-col gap-8 px-4 py-8 sm:px-8 lg:px-14 lg:py-14">
        <div>
          <BackLink href="/library" className="text-small font-medium text-accent">
            ← Library
          </BackLink>
          <h1 className="mt-2 text-title font-bold tracking-snug">Recently deleted</h1>
          <p className="mt-1.5 text-body text-muted">Deleted documents stay here, encrypted, until they are purged. Restore puts them back exactly as they were.</p>
        </div>
        {docs.length === 0 && (
          <EmptyState
            compact
            title="Nothing deleted"
            body="Documents you delete land here first, so a wrong click is never final. None have been deleted yet."
            action="Browse the library"
            href="/library"
          />
        )}
        <ul className="flex flex-col">
          {docs.map((d) => (
            <li key={d.id} className="flex min-h-14 items-center gap-4 border-t border-border py-2.5 last:border-b xl:py-0">
              <div className="h-[38px] w-[30px] shrink-0 rounded-sm border border-border bg-surface" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 xl:flex-row xl:items-center xl:gap-4">
                <span className="truncate text-row font-semibold xl:flex-[0_1_420px]">{d.title}</span>
                <span className="min-w-0 truncate text-small text-muted xl:flex-1">
                  {d.categoryPath ?? "Inbox"} · {d.originalFilename} · deleted {formatRelative(d.deletedAt)}
                </span>
              </div>
              <RestoreButton id={d.id} />
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
