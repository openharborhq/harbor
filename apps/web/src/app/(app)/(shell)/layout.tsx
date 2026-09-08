import { Sidebar } from "@/components/shell/Sidebar";
import type { Category, RecentDocument } from "@harbor/shared";
import { apiFetch, currentUser } from "@/lib/api-server";

/** The vault as it is normally used: the sidebar, and a page beside it. */
export default async function ShellLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  if (!user) return null; // (app) has already redirected; this is only for the type.
  // Neither is worth failing the whole shell over.
  const [categories, recent] = await Promise.all([
    apiFetch<Category[]>("/categories").catch(() => [] as Category[]),
    apiFetch<RecentDocument[]>("/documents/recent").catch(() => [] as RecentDocument[]),
  ]);
  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} categories={categories} recent={recent} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
