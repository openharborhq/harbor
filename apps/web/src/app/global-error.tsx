"use client";

/**
 * Last resort: the root layout itself failed, so this renders its own <html>.
 *
 * Which also means no stylesheet and no design tokens — everything here is inline, and an inline
 * style cannot carry a media query. So the theme arrives as one small <style> block instead: the
 * light values on `:root`, the dark ones under `prefers-color-scheme`, and `color-scheme` so the
 * browser paints the canvas behind this page to match rather than flashing white around it.
 *
 * Kept deliberately small. This page exists for the moment everything else is broken, and a theme
 * is not worth a second failure — but a full-bleed white page at 3am, from an app that is dark
 * every other time you open it, reads as "something is very wrong" before the heading is even read.
 */
const THEME = `
  :root { color-scheme: light; --g:#ffffff; --t:#0d1622; --m:#586471; }
  @media (prefers-color-scheme: dark) {
    :root { color-scheme: dark; --g:#0f1723; --t:#e6ecf5; --m:#a7b4c6; }
  }
  body { background: var(--g); color: var(--t); }
`;

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "80px 56px" }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Harbor didn&apos;t start</h1>
        <p style={{ fontSize: 15, color: "var(--m)", maxWidth: 520, lineHeight: 1.5 }}>
          The app failed to load. Your documents are on disk and untouched. Reload, and if it keeps happening check that
          the API and Postgres containers are running.
        </p>
        {/*
          The cobalt that does not flip, with white on it — the same pairing the rest of the app
          uses for a filled action, and legible on either ground (9.12:1).
        */}
        <button
          type="button"
          onClick={reset}
          style={{ height: 40, borderRadius: 8, border: 0, background: "#123FA8", color: "#fff", padding: "0 16px", fontSize: 14, fontWeight: 600 }}
        >
          Try again
        </button>
        {error.digest && <p style={{ fontSize: 13, color: "var(--m)" }}>Reference {error.digest}</p>}
      </body>
    </html>
  );
}
