"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

/**
 * A document, over the whole window (spec §4).
 *
 * Reading a document is a different mode from filing them: the preview wants every pixel, and the
 * sidebar and search that surround a list are not what anyone is looking at. So it takes the
 * screen — no app chrome, one way out, Escape.
 *
 * It is a real route rather than an intercepted one, and that is deliberate. Interception would
 * keep the list mounted underneath, which buys nothing when the layer is opaque and full-screen,
 * and costs a routing arrangement whose behaviour differs between a click and a refresh. This way
 * the URL is the document either way: shareable, refreshable, and back closes it.
 */
export function DocumentOverlay({ children }: { children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    // The page underneath must not scroll while this is over it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      // Not while someone is typing a title or a note — Escape there belongs to the field.
      const el = document.activeElement;
      const typing = el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      if (e.key === "Escape" && !typing) close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Back where you came from, or the library.
   *
   * `router.back()` on a tab opened straight at this URL would leave Harbor altogether — a link
   * from a colleague, a bookmark, a refreshed tab. `history.length` is the only signal a browser
   * gives for "is there anywhere of ours to go back to".
   */
  function close() {
    if (window.history.length > 1) router.back();
    else router.push("/library");
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-ground">
      <header className="flex h-[60px] shrink-0 items-center justify-end px-4 lg:px-8">
        <button
          type="button"
          onClick={close}
          aria-label="Close (Esc)"
          className="flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-5" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
