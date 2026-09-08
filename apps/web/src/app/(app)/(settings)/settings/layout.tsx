import Link from "next/link";
import { SettingsNav } from "./SettingsNav";

/**
 * Settings takes the window over rather than sitting inside it: the vault's own sidebar is gone
 * and this one replaces it, with a way back at the top. Configuration is a different mode from
 * looking at your paperwork, and the screen should say so without a modal.
 *
 * The content column is capped at 620px inside a wider page. The empty right-hand third is
 * deliberate — most of this section is prose about what the box does with your documents, and
 * prose wants a readable line, not a filled window.
 */
export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <div className="flex min-h-screen bg-ground">
      <aside className="sticky top-0 flex h-screen w-sidebar shrink-0 flex-col gap-[26px] overflow-y-auto border-r border-border bg-surface px-5 pt-[26px] pb-6">
        <Link href="/home" className="-ml-1.5 flex h-[30px] shrink-0 items-center gap-2 rounded-md px-1.5 text-row font-medium text-muted hover:bg-ground hover:text-text">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <path d="M10 3.5L5.5 8L10 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Harbor
        </Link>
        <SettingsNav />
      </aside>

      <main className="flex min-w-0 grow flex-col gap-9 px-14 pt-12 pb-[72px]">{children}</main>
    </div>
  );
}
