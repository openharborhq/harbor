"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * Below `lg` there is no room for a 248px sidebar beside the page, so the sidebar slides in over
 * it instead and a burger in the top bar opens it. The burger and the sidebar are drawn in
 * different parts of the tree — the top bar belongs to each page, the sidebar to the shell — so
 * the open flag lives here, owned by neither.
 */
const DrawerContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

export function NavDrawer({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    // The page underneath scrolling while you drag the drawer is the giveaway that this is a panel
    // bolted on rather than a screen of its own.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Widening past lg pins the sidebar open on its own and drops the backdrop, so nothing should be
  // left locked behind an overlay that is no longer drawn.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 64rem)");
    const onChange = () => wide.matches && setOpen(false);
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  return <DrawerContext.Provider value={{ open, setOpen }}>{children}</DrawerContext.Provider>;
}

export function useNavDrawer() {
  const drawer = useContext(DrawerContext);
  if (!drawer) throw new Error("useNavDrawer needs a <NavDrawer> above it");
  return drawer;
}

/** The burger itself. Hidden at lg, where the sidebar is always on screen. */
export function MenuButton() {
  const { open, setOpen } = useNavDrawer();
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-label="Menu"
      aria-expanded={open}
      aria-controls="shell-sidebar"
      className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-md text-text hover:bg-surface lg:hidden"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  );
}
