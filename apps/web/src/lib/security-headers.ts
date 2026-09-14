/**
 * Security headers for the app (spec §3.2, §10.6).
 *
 * These were missing entirely, which was defensible while the only way to reach Harbor was a
 * tailnet. Sharing changes the argument: a doorman is about to face the public internet from the
 * same box, the browser that opens a share link is the same browser that has a session here, and
 * `harbor public enable` refuses to run until this is in place.
 *
 * The app is **not** the thing being exposed — only the doorman is, on its own origin and with its
 * own, much stricter policy. What these headers defend against is the ordinary web attack that
 * arrives through a link: a page in another tab framing the vault, a script injected into a
 * document title, a referrer carrying a document id to somewhere else.
 */

/**
 * One honest limitation, stated here rather than discovered later: `script-src` allows
 * `'unsafe-inline'`.
 *
 * Next's App Router emits inline bootstrap and hydration scripts on every page. Removing that
 * allowance means generating a per-request nonce in middleware and threading it through every
 * render — worth doing, and tracked in the to-do, but it is a change to how every page is served
 * and does not belong in the same commit as a header list. Modern browsers ignore
 * `'unsafe-inline'` when a hash or nonce is present, so this becomes strictly tighter the day the
 * nonce lands, with no other edits.
 *
 * Everything else is closed: no plugins, no framing, no base-tag rewriting, form posts only to
 * ourselves, and connections only to our own origin — which is all the app makes, since /api is a
 * same-origin rewrite rather than a cross-origin call.
 */
/**
 * React's **development** build calls `eval()` — for reconstructing call stacks and other
 * debugging features — and says so in the console the moment a policy forbids it. The production
 * build never does, so the allowance is scoped to the dev server and never reaches an image.
 *
 * The caller passes this rather than the module reading `NODE_ENV`: next.config.ts is evaluated
 * in a context where that variable does not reliably say which server is starting, and a CSP that
 * silently loosens itself based on an ambient variable is the wrong shape for this file anyway.
 */
function csp(dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Thumbnails and avatars are same-origin; data: is for the canvases PdfPages draws into.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The dev server's hot-reload channel is a websocket to the same host.
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    // pdf.js runs its parser in a worker loaded from our own bundle.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export const securityHeaders = (dev = false) => [
  { key: "Content-Security-Policy", value: csp(dev) },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  /**
   * `strict-origin-when-cross-origin` would still send the origin outward. Harbor makes no
   * outbound requests from the browser, so there is nothing to lose by sending nothing.
   */
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  /**
   * Two years, subdomains included. Harbor is served over HTTPS by `tailscale serve` with a real
   * certificate, so there is no plaintext mode to preserve — and the tailnet name is a subdomain
   * of a shared `ts.net`, which is exactly where an accidental http:// would leak a cookie.
   *
   * Not `preload`: that is a public list with a slow exit, and a vault's hostname has no business
   * on one.
   */
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

