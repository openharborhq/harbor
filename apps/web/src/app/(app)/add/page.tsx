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
      <main className="flex max-w-[1192px] flex-col gap-10 px-14 py-14">
        <div>
          <h1 className="text-title font-bold tracking-snug">Add documents</h1>
          <p className="mt-1.5 text-body text-muted">Bills, scans, photos of paperwork — drop them all at once. Everything lands in your Inbox to be filed, unless you file it here.</p>
        </div>
        <UploadQueue categories={categories} items={items} />
      </main>
    </>
  );
}
