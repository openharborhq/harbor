"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The seven sections, in the order they are drawn: who you are (Account, Users, Devices), then
 * what the vault talks to (Email Ingest, Integrations, Backup), then what it is (Version).
 */
const SECTIONS = [
  { href: "/settings", label: "Account" },
  { href: "/settings/users", label: "Users" },
  { href: "/settings/devices", label: "Devices" },
  { href: "/settings/mail", label: "Email Ingest" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/backup", label: "Backup" },
  { href: "/settings/version", label: "Version" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-px">
      {SECTIONS.map((s) => {
        // "/settings" is every other section's prefix, so it only matches itself.
        const active = s.href === "/settings" ? pathname === "/settings" : pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <Link
            key={s.href}
            href={s.href}
            className={`flex h-[34px] items-center rounded-md px-2.5 text-row ${
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
