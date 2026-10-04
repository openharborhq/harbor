"use client";

import { useState, type ReactNode } from "react";

/**
 * The details of a document on a phone: a sheet pulled up over the page (spec §4).
 *
 * Below lg there is no room for the preview and the panel side by side, and stacking five tabs of
 * metadata under the page buried what someone opened it for — what it is, what it is for, what is
 * still to do — under a tab strip. So the sheet leads with that, and the whole panel sits behind
 * "All details", one tap away rather than gone.
 *
 * From lg up this element is `display: contents`: it draws nothing, the phone-only parts are
 * hidden, and the panel passed as `children` is a direct child of the side-by-side row again,
 * exactly as it was before the sheet existed.
 */
export function DocumentSheet({ top, actions, children }: { top: ReactNode; actions: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative z-10 -mt-6 flex shrink-0 grow flex-col rounded-t-[20px] bg-ground pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(13,22,34,0.12)] lg:contents">
      <div className="flex flex-col lg:hidden">
        {/* Decoration, as on any sheet: it says "this is a layer over the page", nothing more. */}
        <div aria-hidden="true" className="flex justify-center pb-1 pt-2">
          <div className="h-[5px] w-9 rounded-pill bg-border-strong" />
        </div>
        {top}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="document-all-details"
          className="mt-2 flex min-h-[52px] items-center justify-between px-5 text-left text-copy font-semibold"
        >
          All details
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`size-5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
      <div id="document-all-details" className={open ? "contents" : "hidden lg:contents"}>
        {children}
      </div>
      {/* Further from the panel's own buttons when it is open, so the two rows do not read as one. */}
      {/* Wraps so an action can take a row of its own with `basis-full`. */}
      <div className={`flex flex-wrap gap-x-2.5 gap-y-1 px-5 lg:hidden ${open ? "pt-6" : "pt-2.5"}`}>{actions}</div>
    </div>
  );
}
