"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Catches failures in the (app) layout itself — chiefly `currentUser()`, which is the first thing
 * every page does and the first thing to fail when the API container is down. A sibling
 * error.tsx cannot catch its own layout, so this one has to live at the root.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex max-w-[640px] flex-col gap-4 px-8 py-24">
      <h1 className="text-title font-bold tracking-snug">Can&apos;t reach the vault</h1>
      <p className="text-body text-muted">
        The app is running but the API isn&apos;t answering. Your documents are on disk and untouched — nothing here
        deletes or changes anything on its own.
      </p>
      <p className="text-body text-muted">
        If you are running this yourself, check that the <code className="rounded-sm bg-surface px-1.5 py-0.5 text-small">api</code>{" "}
        and <code className="rounded-sm bg-surface px-1.5 py-0.5 text-small">postgres</code> containers are up.
      </p>
      <div className="mt-2 flex items-center gap-4">
        <button type="button" onClick={reset} className="h-10 rounded-md bg-accent px-4 text-row font-semibold text-white">
          Try again
        </button>
        <Link href="/home" className="text-row font-medium text-accent">
          Home
        </Link>
      </div>
      {error.digest && <p className="mt-2 text-small text-muted">Reference {error.digest}</p>}
    </main>
  );
}
