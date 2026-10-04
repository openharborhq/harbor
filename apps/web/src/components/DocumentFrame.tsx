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
  /** Names the dialog for a screen reader; the visible title is inside `header` (in the sheet, on a phone). */
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
      {/*
        On a phone the band is only a way back — the title moves into the sheet over the page, where
        it has the width to wrap, and the two file actions move to the foot of it. "Back" rather
        than a cross because on a phone this is a screen you go into, not a layer you dismiss.
      */}
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-border bg-surface px-1.5 sm:gap-6 sm:px-3 lg:h-[68px] lg:border-b lg:bg-transparent lg:px-8">
        {variant === "modal" ? (
          <Dialog.Close className={BACK}>
            <BackIcon />
            Back
          </Dialog.Close>
        ) : (
          <button type="button" onClick={close} className={BACK}>
            <BackIcon />
            Back
          </button>
        )}
        <div className="hidden min-w-0 flex-1 lg:block">{header}</div>
        {variant === "modal" ? (
          <Dialog.Close
            aria-label="Close (Esc)"
            className="hidden size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text lg:flex"
          >
            <CloseIcon />
          </Dialog.Close>
        ) : (
          <button
            type="button"
            onClick={close}
            aria-label="Close (Esc)"
            className="hidden size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text lg:flex"
          >
            <CloseIcon />
          </button>
        )}
      </header>
      {/*
        No scrolling here at lg. The two panes below own the remaining height and scroll separately,
        so reading the last page of a PDF never drags the details out of view.

        Narrower than that there is no room for them side by side, so they stack — the document on
        top at a fixed height, the details under it — and this is what scrolls.
      */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-visible">{children}</div>
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
          // On a phone a 16px inset only takes width from the document; the sheet takes the screen.
          className="dialog-panel fixed inset-0 z-50 flex flex-col overflow-hidden bg-ground shadow-[0_24px_64px_rgba(13,22,34,0.28)] outline-none sm:inset-4 sm:rounded-card sm:border sm:border-border lg:inset-8"
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

const BACK = "flex h-11 shrink-0 items-center gap-0.5 rounded-md pl-1 pr-2.5 text-copy font-medium text-accent lg:hidden";

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="size-6" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-5" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
