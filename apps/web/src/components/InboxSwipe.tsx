"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, type ReactNode } from "react";

/** A swipe commits past this share of the card's width, or faster than FLICK in px/ms. */
const COMMIT = 0.25;
const FLICK = 0.45;
/** Movement before a gesture is read as horizontal or vertical. */
const SLOP = 10;
const OUT_MS = 170;
const IN_MS = 200;

/** Where a drag must not start: anything that takes its own input, and the pinned decision bar. */
const OWN_INPUT = "input, select, textarea, [data-no-swipe]";

/**
 * Swipe left for the next document in the Inbox, right for the one before (spec §4.3).
 *
 * The card follows the finger and either settles back or slides out, and the next one slides in
 * from the side it came from. Vertical scrolling is the browser's (`touch-action: pan-y`), so a
 * drag that starts mostly downwards is a scroll and never a swipe.
 *
 * Moved with `left`, not a transform: the card pins its decision bar to the foot of the screen
 * with `position: fixed`, and a transformed ancestor would make that bar slide with the card.
 * Relatively positioned, the card moves and the bar stays where the thumb is.
 *
 * The swipe is a shortcut, not the way: the Next control in the header does the same and is the
 * one a keyboard or a screen reader reaches.
 */
export function InboxSwipe({
  itemKey,
  prevHref,
  nextHref,
  children,
}: {
  /** Changes when a different document is showing — what the enter animation keys off. */
  itemKey: string;
  prevHref?: string;
  nextHref?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; t: number; axis: "x" | "y" | null; dx: number } | null>(null);
  /** The direction the last committed swipe went, for the card that replaces it to enter from. */
  const leaving = useRef<-1 | 1 | null>(null);
  /** Set by a horizontal drag, so the click its release produces does not open the page under it. */
  const swallowClick = useRef(false);

  function place(px: number, ms = 0) {
    const el = ref.current;
    if (!el) return;
    el.style.transition = ms ? `left ${ms}ms cubic-bezier(0.2, 0.8, 0.3, 1)` : "none";
    el.style.left = `${px}px`;
  }

  // The new document arrives from the side opposite to where the old one went.
  useLayoutEffect(() => {
    const dir = leaving.current;
    const el = ref.current;
    if (dir === null || !el) return;
    leaving.current = null;
    place(-dir * el.offsetWidth);
    const raf = requestAnimationFrame(() => place(0, IN_MS));
    return () => cancelAnimationFrame(raf);
  }, [itemKey]);

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse" || drag.current) return;
    swallowClick.current = false;
    if (e.target instanceof Element && e.target.closest(OWN_INPUT)) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, axis: null, dx: 0 };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.axis === null) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.axis === "x") {
        swallowClick.current = true;
        // Keeps the moves coming when the finger leaves the card. Throws if the browser has
        // already let the pointer go, which only means there is nothing left to capture.
        try {
          ref.current?.setPointerCapture(e.pointerId);
        } catch {}
      }
    }
    if (d.axis !== "x") return;
    // Resistance where there is nothing to go to, so the edge is felt rather than reached.
    const blocked = (dx < 0 && !nextHref) || (dx > 0 && !prevHref);
    d.dx = blocked ? dx / 4 : dx;
    place(d.dx);
  }

  function onPointerEnd(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.axis !== "x") return;
    const el = ref.current;
    const width = el?.offsetWidth ?? 1;
    const speed = Math.abs(d.dx) / Math.max(1, e.timeStamp - d.t);
    const href = d.dx < 0 ? nextHref : prevHref;
    const far = Math.abs(d.dx) > width * COMMIT || speed > FLICK;
    if (!href || !far || e.type === "pointercancel") {
      place(0, IN_MS);
      return;
    }
    const dir = d.dx < 0 ? -1 : 1;
    leaving.current = dir;
    place(dir * width, OUT_MS);
    window.setTimeout(() => {
      router.push(href, { scroll: false });
      window.scrollTo({ top: 0 });
    }, OUT_MS);
  }

  // A drag that ends over the page preview is not a tap on it.
  function onClickCapture(e: React.MouseEvent) {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <div
      ref={ref}
      className="relative touch-pan-y"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={onClickCapture}
    >
      {children}
    </div>
  );
}
