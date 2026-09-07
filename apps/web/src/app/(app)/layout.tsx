import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import type { Category } from "@trustworthier/shared";
import { apiFetch, currentUser } from "@/lib/api-server";

/** Everything under (app) requires a fully verified session; the API is the source of truth. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const categories = await apiFetch<Category[]>("/categories").catch(() => [] as Category[]);
  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} categories={categories} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
