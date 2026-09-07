"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Category, SessionUser } from "@trustworthier/shared";
import { api } from "@/lib/api-client";
import { Brand } from "./Brand";

const NAV: { href: string; label: string; icon: string; soon?: boolean }[] = [
  { href: "/inbox", label: "Inbox", icon: "M3 12h4l2 3h6l2-3h4M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" },
  { href: "/library", label: "Library", icon: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm4 3h8M8 12h8M8 16h5" },
  { href: "/people", label: "People", icon: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8.5 8v-1a4 4 0 0 0-3-3.9M15 4.1a3.5 3.5 0 0 1 0 6.8" },
  { href: "/settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-1.7-1L15 3.5H9l-.3 2.5a7.5 7.5 0 0 0-1.7 1L4.7 6.1l-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 1.7 1L9 20.5h6l.3-2.5a7.5 7.5 0 0 0 1.7-1l2.3.9 2-3.4-2-1.5c.1-.3.1-.7.1-1Z", soon: true },
];

export function Sidebar({ user, categories = [] }: { user: SessionUser; categories?: Category[] }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await api("/auth/logout", { method: "POST" });
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <aside className="sticky top-0 flex h-screen w-sidebar shrink-0 flex-col border-r border-border bg-ground px-5 py-6">
      <Brand />
      <nav className="mt-9 flex flex-col gap-1">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const cls = active
            ? "bg-accent-soft text-accent font-semibold"
            : item.soon
              ? "text-muted/70 cursor-default"
              : "text-text font-medium hover:bg-surface";
          const inner = (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d={item.icon} />
              </svg>
              <span className="flex-1">{item.label}</span>
              {item.soon && <span className="text-label uppercase tracking-label text-muted/70">soon</span>}
            </>
          );
          return item.soon ? (
            <span key={item.href} className={`flex h-[34px] items-center gap-3 rounded-md px-3 text-row ${cls}`}>{inner}</span>
          ) : (
            <Link key={item.href} href={item.href} className={`flex h-[34px] items-center gap-3 rounded-md px-3 text-row ${cls}`}>{inner}</Link>
          );
        })}
      </nav>
      {categories.length > 0 && (
        <div className="mt-8">
          <div className="label px-3">Pinned categories</div>
          <ul className="mt-2 flex flex-col">
            {categories
              .filter((c) => c.parentId === null)
              .slice(0, 8)
              .map((c) => (
                <li key={c.id}>
                  <Link href={`/library?category=${c.id}`} className="flex h-8 items-center gap-3 rounded-md px-3 text-row text-text hover:bg-surface">
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-small text-muted">{countWithChildren(c, categories)}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      )}
      <div className="mt-auto border-t border-border pt-4">
        <div className="flex items-center gap-3">
          <div className="flex size-7 items-center justify-center rounded-pill bg-surface text-label font-bold text-muted">
            {user.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-row font-medium">{user.displayName}</div>
            <div className="truncate text-label text-muted">{user.email}</div>
          </div>
          <button type="button" onClick={signOut} className="text-small font-medium text-muted hover:text-text">
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}

function countWithChildren(top: Category, all: Category[]): number {
  return top.documentCount + all.filter((c) => c.parentId === top.id).reduce((n, c) => n + c.documentCount, 0);
}
