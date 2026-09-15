import { ShareBasketProvider } from "@/components/share/ShareBasket";
import { NavDrawer } from "@/components/shell/NavDrawer";
import { Sidebar } from "@/components/shell/Sidebar";
import type { Category, InboxCount, RecentDocument, TaskCount } from "@harbor/shared";
import { apiFetch, currentUser } from "@/lib/api-server";

const NO_INBOX: InboxCount = { needsReview: 0, notPaperwork: 0 };
const NO_TASKS: TaskCount = { pressing: 0, open: 0, unpaid: [] };

/**
 * The vault as it is normally used: the sidebar, and a page beside it.
 *
 * Plus a `@modal` slot, which a document opened from a list fills — the list stays mounted and
 * visible behind it, and closing returns to it exactly as it was.
 */
export default async function ShellLayout({ children, modal }: LayoutProps<"/">) {
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
    <ShareBasketProvider>
      <NavDrawer>
        <div className="flex min-h-screen">
          <Sidebar user={user} categories={categories} recent={recent} inbox={inbox} tasks={tasks} />
          {/*
            One centred column for every page, header included. The pages already capped at 1192px
            — the locked content width — but none of them centred, so on a wide screen the whole
            app sat against the sidebar with the gutter all on one side.
          */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="mx-auto flex w-full max-w-content flex-1 flex-col">{children}</div>
          </div>
        </div>
      </NavDrawer>
      {/* The @modal slot: null on every page but a document opened from a list. */}
      {modal}
    </ShareBasketProvider>
  );
}
