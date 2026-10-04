import type { Metadata } from "next";
import type { Category, Item } from "@harbor/shared";
import { UploadQueue } from "@/components/UploadQueue";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";

export const metadata: Metadata = { title: "Add documents" };

export default async function AddPage() {
  const [categories, items] = await Promise.all([apiFetch<Category[]>("/categories"), apiFetch<Item[]>("/items")]);
  return (
    <>
      <TopBar />
      {/* On a phone this page is what the round "+" opens: a title, three ways in, and the files on
          their way. Nothing to drop onto, so the introduction shrinks to the one fact worth
          knowing — where the files end up. */}
      <main className="mx-auto flex w-full max-w-[1192px] flex-col gap-5 px-5 pt-4 pb-10 sm:px-8 sm:py-8 lg:gap-10 lg:px-14 lg:py-14">
        <div>
          <h1 className="text-title font-bold tracking-snug">Add documents</h1>
          <p className="mt-1.5 text-copy text-muted lg:hidden">They land in the Inbox, ready to file.</p>
          <p className="mt-1.5 hidden text-body text-muted lg:block">Bills, scans, photos of paperwork — drop them all at once. Everything lands in your Inbox to be filed, unless you file it here.</p>
        </div>
        <UploadQueue categories={categories} items={items} />
      </main>
    </>
  );
}
