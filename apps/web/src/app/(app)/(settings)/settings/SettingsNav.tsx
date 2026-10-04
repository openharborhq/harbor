"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * The sections, in the order they are drawn: who you are (Account, Users, Devices), what the vault
 * does with a document (Documents), then what it talks to (Email Ingest, Integrations, Sharing,
 * Backup), then what it is (Version).
 */
const SECTIONS = [
  { href: "/settings", label: "Account" },
  { href: "/settings/users", label: "Users" },
  { href: "/settings/devices", label: "Devices" },
  { href: "/settings/documents", label: "Documents" },
  { href: "/settings/mail", label: "Email Ingest" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/sharing", label: "Sharing" },
  { href: "/settings/backup", label: "Backup" },
  { href: "/settings/version", label: "Version" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Below lg the sections are a row wider than the screen. Arriving at Backup should not leave
  // its own tab scrolled out of sight at the far end.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 pb-3 lg:mx-0 lg:flex-col lg:gap-px lg:overflow-visible lg:px-0 lg:pb-0">
      {SECTIONS.map((s) => {
        // "/settings" is every other section's prefix, so it only matches itself.
        const active = s.href === "/settings" ? pathname === "/settings" : pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <Link
            key={s.href}
            ref={active ? activeRef : undefined}
            href={s.href}
            className={`flex h-[34px] shrink-0 items-center whitespace-nowrap rounded-md px-2.5 text-row ${
              active ? "bg-accent-soft font-semibold text-accent" : "font-medium text-text hover:bg-ground"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
