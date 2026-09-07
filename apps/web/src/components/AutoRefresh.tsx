"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-render the server component tree every few seconds while something is still processing. */
export function AutoRefresh({ active, everyMs = 2500 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
