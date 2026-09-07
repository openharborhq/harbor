"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A "← Inbox" that actually goes back.
 *
 * These were plain links, which is a forward navigation to a freshly-scrolled page: open a
 * document from halfway down the Inbox, click the arrow, and you land at the top with 40 cards
 * to scroll past. The browser's own Back button restored the position perfectly — the arrow that
 * looked like Back was the one that did not behave like it.
 *
 * It stays a real link so middle-click, ⌘-click and right-click → open in new tab all work, and
 * so it still points somewhere sensible when there is nothing to go back to — arriving from a
 * bookmark, or a fresh tab. Only a plain left click is turned into history.back().
 */
export function BackLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();

  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        // Let the browser handle anything that is not a plain primary click.
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        // Checked at click time rather than kept in state: no effect, and no stale answer.
        if (window.history.length <= 1) return;
        e.preventDefault();
        router.back();
      }}
    >
      {children}
    </Link>
  );
}
