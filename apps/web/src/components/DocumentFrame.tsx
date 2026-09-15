"use client";

import * as Dialog from "@radix-ui/react-dialog";
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
 *
 * The modal is a Radix dialog rather than a hand-rolled layer. What that buys is the part nobody
 * sees: focus moves in and is trapped, the page behind is hidden from screen readers, scroll is
 * locked without the layout shifting as the scrollbar goes, and focus returns to whatever opened
 * it. It also exposes `data-state`, which is what lets a closing dialog animate out instead of
 * disappearing on the frame it was dismissed.
 */
export function DocumentFrame({
  variant,
  header,
  title,
  children,
}: {
  variant: "page" | "modal";
  header?: ReactNode;
  /** Names the dialog for a screen reader; the visible title is inside `header`. */
  title: string;
  children: ReactNode;
}) {
  const router = useRouter();

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

  const body = (
    <>
      {/*
        The title band is the header rather than the top of the left pane: it belongs to both
        panes, and putting it inside one of them would either shrink the preview or scroll away
        while the details stayed.
      */}
      <header className="flex h-[68px] shrink-0 items-center gap-6 border-b border-border px-5 lg:px-8">
        <div className="min-w-0 flex-1">{header}</div>
        {variant === "modal" ? (
          <Dialog.Close
            aria-label="Close (Esc)"
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <CloseIcon />
          </Dialog.Close>
        ) : (
          <button
            type="button"
            onClick={close}
            aria-label="Close (Esc)"
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <CloseIcon />
          </button>
        )}
      </header>
      {/*
        No scrolling here. The two panes below own the remaining height and scroll separately, so
        reading the last page of a PDF never drags the details out of view.
      */}
      <div className="flex min-h-0 flex-1">{children}</div>
    </>
  );

  if (variant === "page") {
    // Not a dialog: there is nothing behind it to trap focus away from, and a page that announced
    // itself as modal would be lying to a screen reader.
    return <PageFrame onClose={close}>{body}</PageFrame>;
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        // Radix reports Escape, the close button and an outside press the same way. Closing is a
        // navigation here, so the route is what actually dismisses it.
        if (!next) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-40 bg-scrim/40" />
        <Dialog.Content
          className="dialog-panel fixed inset-4 z-50 flex flex-col overflow-hidden rounded-card border border-border bg-ground shadow-[0_24px_64px_rgba(13,22,34,0.28)] outline-none lg:inset-8"
          // The document is the thing to read; the frame should not read its own title aloud first.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {body}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The full-window variant: same bands, no dialog semantics, Escape by hand. */
function PageFrame({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      // Not while someone is typing a title or a note — Escape there belongs to the field.
      const el = document.activeElement;
      const typing = el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      if (e.key === "Escape" && !typing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return <div className="fixed inset-0 z-40 flex flex-col bg-ground">{children}</div>;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-5" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
