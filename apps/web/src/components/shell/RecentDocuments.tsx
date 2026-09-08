"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { RecentDocument } from "@harbor/shared";
import { api } from "@/lib/api-client";

/** Rows visible before the list starts scrolling, and the height that many rows occupy. */
const VISIBLE = 7;
const ROW_PX = 32;

/**
 * The last documents this owner opened. Seeded from the server so it is right on first paint,
 * then refetched on every navigation — the (app) layout is a server component and Next reuses it
 * across route changes, so without this the list would only move on a full reload.
 */
export function RecentDocuments({ initial }: { initial: RecentDocument[] }) {
  const pathname = usePathname();
  const [recent, setRecent] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    // The document page records the view during its own server render, which finishes before this
    // navigation commits — so by now the row is written.
    api<RecentDocument[]>("/documents/recent")
      .then((rows) => {
        if (!cancelled) setRecent(rows);
      })
      .catch(() => {
        /* the sidebar is not worth an error; the list simply stays as it was */
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (recent.length === 0) return null;

  return (
    <div className="mt-8 flex shrink-0 flex-col">
      <div className="label px-3">Recent</div>
      <ul
        className={`mt-2 flex flex-col ${recent.length > VISIBLE ? "overflow-y-auto" : ""}`}
        style={recent.length > VISIBLE ? { maxHeight: VISIBLE * ROW_PX } : undefined}
      >
        {recent.map((r) => {
          const active = pathname === `/documents/${r.documentId}`;
          return (
            <li key={r.documentId}>
              <Link
                href={`/documents/${r.documentId}`}
                title={`${r.title}${r.categoryPath ? ` · ${r.categoryPath}` : ""}`}
                className={`flex h-8 items-center gap-3 rounded-md px-3 text-row hover:bg-ground ${
                  active ? "bg-accent-soft font-semibold text-accent" : "text-text"
                }`}
              >
                <span className="flex-1 truncate">{r.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
