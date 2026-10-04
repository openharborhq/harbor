"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Category, InboxCount, RecentDocument, SessionUser, TaskCount } from "@harbor/shared";
import { api } from "@/lib/api-client";
import { initials } from "@/lib/initials";
import { Brand } from "./Brand";
import { useNavDrawer } from "./NavDrawer";
import { RecentDocuments } from "./RecentDocuments";

const NAV: { href: string; label: string; icon: string; soon?: boolean }[] = [
  { href: "/home", label: "Home", icon: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z" },
  { href: "/inbox", label: "Inbox", icon: "M3 12h4l2 3h6l2-3h4M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" },
  { href: "/todo", label: "To do", icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-3.6-9.2 2.5 2.5 4.7-5.2" },
  { href: "/library", label: "Library", icon: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm4 3h8M8 12h8M8 16h5" },
  { href: "/items", label: "People & things", icon: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8.5 8v-1a4 4 0 0 0-3-3.9M15 4.1a3.5 3.5 0 0 1 0 6.8" },
  { href: "/shares", label: "Shared", icon: "M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M12 3v13M8 7l4-4 4 4" },
  { href: "/settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-1.7-1L15 3.5H9l-.3 2.5a7.5 7.5 0 0 0-1.7 1L4.7 6.1l-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 1.7 1L9 20.5h6l.3-2.5a7.5 7.5 0 0 0 1.7-1l2.3.9 2-3.4-2-1.5c.1-.3.1-.7.1-1Z" },
];

export function Sidebar({
  user,
  categories = [],
  recent = [],
  inbox,
  tasks,
}: {
  user: SessionUser;
  categories?: Category[];
  recent?: RecentDocument[];
  inbox?: InboxCount;
  tasks?: TaskCount;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { open, setOpen } = useNavDrawer();
  const waiting = inbox?.needsReview ?? 0;
  // Overdue and due today only. Counting everything open would mean a badge that never reaches
  // zero, which is a badge nobody reads — the same reason held-back leaflets stay out of the one
  // above.
  const pressing = tasks?.pressing ?? 0;

  async function signOut() {
    await api("/auth/logout", { method: "POST" });
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <>
      {/* Only ever drawn under the drawer; at lg the sidebar is part of the page, not over it. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-30 bg-scrim/40 transition-opacity duration-200 lg:hidden ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      />
      {/* invisible, not just shifted off-canvas: a closed drawer should be out of the tab order and
          out of a screen reader's way, and visibility still animates out with the slide. */}
      <aside
        id="shell-sidebar"
        // Following a link should leave the drawer behind, not sitting over the page you just
        // asked for. Delegated, so recent documents and categories close it too.
        onClick={(e) => e.target instanceof Element && e.target.closest("a") && setOpen(false)}
        className={`fixed inset-y-0 left-0 z-40 flex h-dvh w-[318px] max-w-[85vw] shrink-0 flex-col border-r border-border bg-ground px-3 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[8px_0_30px_rgba(13,22,34,0.12)] transition-[transform,visibility] duration-200 lg:visible lg:sticky lg:top-0 lg:h-screen lg:w-sidebar lg:max-w-none lg:translate-x-0 lg:bg-surface lg:px-5 lg:py-6 lg:shadow-none ${
          open ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between pl-2.5 lg:pl-0">
          <Brand />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-text lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto">
        <nav className="mt-5 flex flex-col gap-0.5 lg:mt-9 lg:gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const cls = active
              ? "bg-accent-soft text-accent font-semibold"
              : item.soon
                ? "text-muted/70 cursor-default"
                : "text-text font-medium hover:bg-ground";
            const inner = (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-6 shrink-0 lg:size-[18px]">
                  <path d={item.icon} />
                </svg>
                <span className="flex-1">{item.label}</span>
                {/* The one count in this nav, because it is the one that means work is waiting.
                    Held-back leaflets are excluded on purpose — the Inbox page offers those
                    separately, and a badge that counted them would be asking for attention on
                    behalf of a newsletter. */}
                {item.href === "/inbox" && waiting > 0 && (
                  <span
                    aria-label={`${waiting} to review`}
                    className={`inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-pill px-1.5 text-[12px] font-bold leading-none lg:h-[18px] lg:min-w-[18px] lg:text-[10px] ${
                      active ? "bg-accent-fill text-white" : "bg-accent-soft text-accent"
                    }`}
                  >
                    {waiting}
                  </span>
                )}
                {item.href === "/todo" && pressing > 0 && (
                  <span
                    aria-label={`${pressing} overdue or due today`}
                    className={`inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-pill px-1.5 text-[12px] font-bold leading-none lg:h-[18px] lg:min-w-[18px] lg:text-[10px] ${
                      active ? "bg-danger text-white" : "bg-danger/10 text-danger"
                    }`}
                  >
                    {pressing}
                  </span>
                )}
                {item.soon && <span className="text-label uppercase tracking-label text-muted/70">soon</span>}
              </>
            );
            return item.soon ? (
              <span key={item.href} className={`flex h-[52px] items-center gap-3.5 rounded-lg px-3 text-copy lg:h-[34px] lg:gap-3 lg:rounded-md lg:text-row ${item.href === "/settings" ? "max-lg:hidden" : ""} ${cls}`}>{inner}</span>
            ) : (
              <Link key={item.href} href={item.href} className={`flex h-[52px] items-center gap-3.5 rounded-lg px-3 text-copy lg:h-[34px] lg:gap-3 lg:rounded-md lg:text-row ${item.href === "/settings" ? "max-lg:hidden" : ""} ${cls}`}>{inner}</Link>
            );
          })}
        </nav>
        <RecentDocuments initial={recent} />
        {/* Not in the drawer: on a phone the categories are a Library filter, one tap further in. */}
        {categories.length > 0 && (
          <div className="mt-8 hidden lg:block">
            <div className="label px-3">Categories</div>
            <ul className="mt-2 flex flex-col">
              {categories
                .filter((c) => c.parentId === null)
                .slice(0, 8)
                .map((c) => (
                  <li key={c.id}>
                    <Link href={`/library?category=${c.id}`} className="flex h-9 items-center gap-3 rounded-md px-3 text-row text-text hover:bg-ground lg:h-8">
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-small text-muted">{countWithChildren(c, categories)}</span>
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        )}
        </div>
        {/*
          On a phone the foot of the drawer is where the account lives: who is signed in, the way
          to Settings, and Sign out — each a full-height row rather than a word at the edge. The
          avatar is centred on the icon lane above, so the name starts where the nav labels do.
        */}
        <div className="mt-auto shrink-0 border-t border-border pt-2 lg:hidden">
          <Link href="/settings" className="flex h-16 items-center gap-2.5 rounded-lg px-2 hover:bg-surface">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-surface text-[13px] font-semibold text-muted">
              {initials(user.displayName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-copy font-semibold">{user.displayName}</div>
              <div className="text-body text-muted">Settings</div>
            </div>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted" aria-hidden="true">
              <path d={NAV.find((n) => n.href === "/settings")!.icon} />
            </svg>
          </Link>
          <button type="button" onClick={signOut} className="flex h-[52px] w-full items-center gap-3.5 rounded-lg px-3 text-copy font-medium text-muted hover:bg-surface hover:text-text">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
              <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3M16 17l5-5-5-5M21 12H9" />
            </svg>
            Sign out
          </button>
        </div>
        <div className="mt-auto hidden shrink-0 border-t border-border pt-4 lg:block">
          <div className="flex items-center gap-3">
            <div className="flex size-7 items-center justify-center rounded-pill bg-ground text-label font-bold text-muted">
              {initials(user.displayName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-row font-medium" title={user.displayName}>
                {user.displayName}
              </div>
            </div>
            <button type="button" onClick={signOut} className="text-small font-medium text-muted hover:text-text">
              Sign out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function countWithChildren(top: Category, all: Category[]): number {
  return top.documentCount + all.filter((c) => c.parentId === top.id).reduce((n, c) => n + c.documentCount, 0);
}
