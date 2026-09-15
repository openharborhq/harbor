"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

/**
 * The frame around a document being read (spec §4).
 *
 * Reading is a different mode from filing: the preview wants the pixels, and the sidebar and
 * search that surround a list are not what anyone is looking at. So it takes almost everything —
 * no app chrome, one way out, Escape.
 *
 * Two variants, because the same view is reached two ways. Opened from a list it is a **modal**,
 * inset far enough to leave the app visible around it, so closing feels like putting something
 * down rather than navigating. Reached by a link, a bookmark or a refresh there is no list behind
 * it to preserve, so it is a **page** and takes the window; framing emptiness would be worse than
 * filling it.
 */
export function DocumentFrame({
  variant,
  header,
  children,
}: {
  variant: "page" | "modal";
  header?: ReactNode;
  children: ReactNode;
}) {
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

  /** Only a press that begins on the backdrop, so a drag out of the document does not close it. */
  function backdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  const frame =
    variant === "modal"
      ? // Inset: enough of the app shows around it to say what you are on top of.
        "absolute inset-4 rounded-card border border-border shadow-[0_24px_64px_rgba(13,22,34,0.28)] lg:inset-8"
      : "absolute inset-0";

  return (
    <div className={variant === "modal" ? "fixed inset-0 z-40 bg-text/40" : "fixed inset-0 z-40"} onMouseDown={variant === "modal" ? backdrop : undefined}>
      <div className={`${frame} flex flex-col overflow-hidden bg-ground`}>
      {/*
        The title band is the header rather than the top of the left pane: it belongs to both
        panes, and putting it inside one of them would either shrink the preview or scroll away
        while the details stayed.
      */}
      <header className="flex h-[68px] shrink-0 items-center gap-6 border-b border-border px-5 lg:px-8">
        <div className="min-w-0 flex-1">{header}</div>
        <button
          type="button"
          onClick={close}
          aria-label="Close (Esc)"
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-5" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      {/*
        No scrolling here. The two panes below own the remaining height and scroll separately, so
        reading the last page of a PDF never drags the details out of view.
      */}
      <div className="flex min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
