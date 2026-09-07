"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Everything under (app) reads through the API, so the overwhelmingly likely cause is that the
 * API container is down rather than a bug in this page. Say that, because it is the difference
 * between "reload" and "check the box".
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex max-w-[720px] flex-col gap-4 px-14 py-20">
      <h1 className="text-title font-bold tracking-snug">This page didn&apos;t load</h1>
      <p className="text-body text-muted">
        Something went wrong reading from the vault. Usually that means the API isn&apos;t reachable — your documents are
        untouched either way, nothing here deletes or changes anything on its own.
      </p>
      <div className="mt-2 flex items-center gap-4">
        <button type="button" onClick={reset} className="h-10 rounded-md bg-accent px-4 text-row font-semibold text-white">
          Try again
        </button>
        <Link href="/home" className="text-row font-medium text-accent">
          Go to Home
        </Link>
      </div>
      {error.digest && <p className="mt-2 text-small text-muted">Reference {error.digest} — it is in the server log too.</p>}
    </main>
  );
}
