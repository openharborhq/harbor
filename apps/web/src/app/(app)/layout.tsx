import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { currentUser } from "@/lib/api-server";

/** Everything under (app) requires a fully verified session; the API is the source of truth. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
