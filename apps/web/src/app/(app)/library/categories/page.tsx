import type { Metadata } from "next";
import type { Category } from "@harbor/shared";
import { BackLink } from "@/components/BackLink";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";
import { CategoryTree } from "./CategoryTree";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const categories = await apiFetch<Category[]>("/categories");
  return (
    <>
      <TopBar />
      <main className="flex max-w-[880px] flex-col gap-8 px-14 py-14">
        <div>
          <BackLink href="/library" className="text-small font-medium text-accent">
            ← Library
          </BackLink>
          <h1 className="mt-1 text-title font-bold tracking-snug">Categories</h1>
          <p className="mt-1.5 text-body text-muted">
            Where documents get filed, at most two levels deep. Renaming one keeps everything filed in it — the
            suggestions the model makes use these names, so they are worth wording the way you think.
          </p>
        </div>
        <CategoryTree categories={categories} />
      </main>
    </>
  );
}
