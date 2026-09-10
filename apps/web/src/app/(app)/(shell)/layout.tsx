import { Sidebar } from "@/components/shell/Sidebar";
import type { Category, InboxCount, RecentDocument, TaskCount } from "@harbor/shared";
import { apiFetch, currentUser } from "@/lib/api-server";

const NO_INBOX: InboxCount = { needsReview: 0, notPaperwork: 0 };
const NO_TASKS: TaskCount = { pressing: 0, open: 0, unpaid: [] };

/** The vault as it is normally used: the sidebar, and a page beside it. */
export default async function ShellLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  if (!user) return null; // (app) has already redirected; this is only for the type.
  // Neither is worth failing the whole shell over.
  const [categories, recent, inbox, tasks] = await Promise.all([
    apiFetch<Category[]>("/categories").catch(() => [] as Category[]),
    apiFetch<RecentDocument[]>("/documents/recent").catch(() => [] as RecentDocument[]),
    apiFetch<InboxCount>("/documents/inbox-count").catch(() => NO_INBOX),
    apiFetch<TaskCount>("/tasks/count").catch(() => NO_TASKS),
  ]);
  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} categories={categories} recent={recent} inbox={inbox} tasks={tasks} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
