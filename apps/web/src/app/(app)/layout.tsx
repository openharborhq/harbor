import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import type { Category, RecentDocument } from "@harbor/shared";
import { apiFetch, currentUser } from "@/lib/api-server";

/** Everything under (app) requires a fully verified session; the API is the source of truth. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
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
