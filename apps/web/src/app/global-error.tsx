"use client";

/** Last resort: the root layout itself failed, so this renders its own <html>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "80px 56px", color: "#0D1622" }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Trustworthier didn&apos;t start</h1>
        <p style={{ fontSize: 15, color: "#586471", maxWidth: 520, lineHeight: 1.5 }}>
          The app failed to load. Your documents are on disk and untouched. Reload, and if it keeps happening check that
          the API and Postgres containers are running.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{ height: 40, borderRadius: 8, border: 0, background: "#123FA8", color: "#fff", padding: "0 16px", fontSize: 14, fontWeight: 600 }}
        >
          Try again
        </button>
        {error.digest && <p style={{ fontSize: 13, color: "#586471" }}>Reference {error.digest}</p>}
      </body>
    </html>
  );
}
