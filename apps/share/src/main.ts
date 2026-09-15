import { createHash } from "node:crypto";
import { appendFile, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { openBundleStream, verifySharePassword } from "@harbor/bundle";

/**
 * harbor-share — the doorman (spec §10.2, §10.6).
 *
 * The only part of Harbor a stranger's browser can reach, and it is deliberately the least
 * capable process on the box: no database, no KEK, no session middleware, no framework, no
 * dependency that is not the bundle format itself. If it falls, what the attacker holds is the
 * bundles that were already being handed out.
 *
 * Its whole interface to the vault is a directory. It never calls the API, and the API never
 * calls it — download counts travel back as an append-only log a worker reads.
 */

const PORT = Number(process.env.SHARE_PORT ?? 4010);
const ROOT = process.env.SHARE_DIR ?? "/data/shares";
const STATE = process.env.SHARE_STATE_DIR ?? path.join(ROOT, "state");

interface Policy {
  shareId: string;
  filename: string;
  expiresAt: string;
  maxDownloads: number | null;
  passwordHash: string | null;
  message: string | null;
  fileCount: number;
  sealedBytes: number;
}

interface LinkState {
  downloads: number;
  firstOpenedAt?: string;
}

/**
 * Nothing in a response tells expired, revoked, limit-reached and never-existed apart — the
 * reason goes to the log and the owner reads it in the app (§10.6).
 */
type Denial = "unknown" | "expired" | "limit" | "bad-password";

async function readPolicy(tokenHash: string): Promise<Policy | null> {
  try {
    // Re-read on every request: that is what makes revoking immediate. Deleting the file is the
    // revocation, and no cached copy can outlive it.
    return JSON.parse(await readFile(path.join(ROOT, "links", tokenHash, "policy.json"), "utf8")) as Policy;
  } catch {
    return null;
  }
}

async function readState(tokenHash: string): Promise<LinkState> {
  try {
    return JSON.parse(await readFile(path.join(STATE, tokenHash, "state.json"), "utf8")) as LinkState;
  } catch {
    return { downloads: 0 };
  }
}

async function writeState(tokenHash: string, state: LinkState): Promise<void> {
  const dir = path.join(STATE, tokenHash);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(dir, "state.json"), JSON.stringify(state), { mode: 0o600 });
}

/** The only thing this process tells anyone. A worker folds it into share_access_log. */
async function logEvent(tokenHash: string, event: string, req: IncomingMessage, extra: Record<string, unknown> = {}): Promise<void> {
  const dir = path.join(STATE, tokenHash);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const line = JSON.stringify({
    at: new Date().toISOString(),
    event,
    ip: req.socket.remoteAddress ?? null,
    userAgent: req.headers["user-agent"] ?? null,
    ...extra,
  });
  await appendFile(path.join(dir, "events.jsonl"), `${line}\n`, { mode: 0o600 });
}

/**
 * Serving attacker-supplied bytes to attacker-chosen browsers on a public origin (§10.6). No
 * cookies are ever set here, and a document is never rendered as HTML.
 */
function harden(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "interest-cohort=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
  res.setHeader("Cache-Control", "no-store");
}

/**
 * Password attempts, per token and per address. A share password guards a bundle that is already
 * expiring, but it is short by nature, so the limiter is what keeps it meaningful.
 */
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.until < now) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function noteAttempt(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.until < now) attempts.set(key, { count: 1, until: now + WINDOW_MS });
  else entry.count++;
}

/** Same delay whether the token is unknown or the password was wrong. */
async function evenOut(): Promise<void> {
  await new Promise((r) => setTimeout(r, 120 + Math.floor(Math.random() * 80)));
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function page(title: string, body: string, status = 200, res?: ServerResponse): string {
  if (res) res.statusCode = status;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
/* Harbor's palette, the same values as the app, the site and the bucket landing page. This file
   carried a fourth near-copy of it, drifted a shade or two on every colour (2026-09-15).
   --fill and --danger are why it matters: this page had white on the lifted --accent at 2.44:1 for
   its Download button, and a hardcoded #a33125 error at 2.59:1 — the sentence that tells a stranger
   why their password did not work, in the dark, on the only page of Harbor they will ever see. */
:root{color-scheme:light dark;--ground:#fff;--surface:#f2f5f9;--border:#dce3ec;--text:#0d1622;--muted:#586471;--accent:#123fa8;--fill:#123fa8;--danger:#a33125}
@media(prefers-color-scheme:dark){:root{--ground:#0f1723;--surface:#162031;--border:#243349;--text:#e6ecf5;--muted:#a7b4c6;--accent:#7ea6ff;--danger:#f08375}}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--text);font:15px/22px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:520px;margin:0 auto;padding:48px 20px}
.card{background:var(--ground);border:1px solid var(--border);border-radius:18px;padding:28px}
h1{font-size:24px;line-height:30px;letter-spacing:-.02em;margin:0 0 8px}
p{margin:0 0 14px;color:var(--muted)}p.lead{color:var(--text)}
.meta{font-size:13px;color:var(--muted);margin:0 0 20px}
label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}
input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--ground);color:var(--text);margin-bottom:16px}
button{font:inherit;font-weight:600;background:var(--fill);color:#fff;border:0;border-radius:8px;padding:11px 20px;cursor:pointer}
.err{color:var(--danger);font-size:13px;margin:-8px 0 14px}
footer{margin-top:22px;font-size:12px;color:var(--muted);text-align:center}
</style></head><body><main><div class="card">${body}</div>
<footer>Sent with Harbor</footer></main></body></html>`;
}

function notFoundPage(res: ServerResponse): string {
  return page(
    "Link not available",
    `<h1>This link isn’t available</h1>
     <p class="lead">It may have expired, been withdrawn, or already been used.</p>
     <p>Ask the person who sent it to share the documents again.</p>`,
    404,
    res,
  );
}

function landingPage(policy: Policy, opts: { token: string; error?: string }): string {
  const expires = new Date(policy.expiresAt);
  const files = `${policy.fileCount} document${policy.fileCount === 1 ? "" : "s"}`;
  return page(
    "Documents shared with you",
    `<h1>${files} shared with you</h1>
     ${policy.message ? `<p class="lead">${esc(policy.message)}</p>` : ""}
     <p class="meta">Available until ${esc(expires.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" }))}.</p>
     <form method="post" action="/s/${encodeURIComponent(opts.token)}/download">
       ${
         policy.passwordHash
           ? `<label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="off" autofocus required>
              ${opts.error ? `<p class="err">${esc(opts.error)}</p>` : ""}`
           : ""
       }
       <button type="submit">Download</button>
     </form>`,
  );
}

/** Reads a form body. Small by construction — the only field is a password. */
async function formBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 4096) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function expired(policy: Policy): boolean {
  return new Date(policy.expiresAt).getTime() <= Date.now();
}

async function deny(res: ServerResponse, tokenHash: string | null, req: IncomingMessage, reason: Denial): Promise<void> {
  await evenOut();
  if (tokenHash) await logEvent(tokenHash, reason === "bad-password" ? "password_failed" : "denied", req, { reason });
  harden(res);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(notFoundPage(res));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://share.local");

  if (url.pathname === "/healthz") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    return void res.end("ok\n");
  }

  const match = /^\/s\/([A-Za-z0-9_-]{16,128})(\/download)?$/.exec(url.pathname);
  if (!match) {
    harden(res);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return void res.end(notFoundPage(res));
  }

  const token = match[1];
  const wantsDownload = Boolean(match[2]);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const policy = await readPolicy(tokenHash);

  if (!policy) return deny(res, null, req, "unknown");
  if (expired(policy)) return deny(res, tokenHash, req, "expired");

  /**
   * GET hands over a page and nothing else. WhatsApp, Slack and Outlook Safe Links all fetch a
   * URL before a human sees it, so a link that burned on GET would be dead on arrival (§10.7).
   */
  if (req.method === "GET" && !wantsDownload) {
    const state = await readState(tokenHash);
    if (!state.firstOpenedAt) await writeState(tokenHash, { ...state, firstOpenedAt: new Date().toISOString() });
    await logEvent(tokenHash, "viewed", req);
    harden(res);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return void res.end(landingPage(policy, { token }));
  }

  if (req.method !== "POST" || !wantsDownload) {
    res.statusCode = 405;
    harden(res);
    return void res.end();
  }

  const limiterKey = `${tokenHash}:${req.socket.remoteAddress ?? ""}`;
  if (rateLimited(limiterKey)) return deny(res, tokenHash, req, "bad-password");

  if (policy.passwordHash) {
    let supplied = "";
    try {
      supplied = (await formBody(req)).get("password") ?? "";
    } catch {
      return deny(res, tokenHash, req, "bad-password");
    }
    noteAttempt(limiterKey);
    if (!(await verifySharePassword(policy.passwordHash, supplied))) {
      await evenOut();
      await logEvent(tokenHash, "password_failed", req);
      harden(res);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.statusCode = 401;
      return void res.end(landingPage(policy, { token, error: "That password is not right." }));
    }
  } else {
    try {
      await formBody(req);
    } catch {
      return deny(res, tokenHash, req, "bad-password");
    }
  }

  const state = await readState(tokenHash);
  if (policy.maxDownloads !== null && state.downloads >= policy.maxDownloads) {
    return deny(res, tokenHash, req, "limit");
  }

  const bundlePath = path.join(ROOT, "bundles", policy.shareId, "bundle");
  const keyPath = path.join(ROOT, "bundles", policy.shareId, "key");
  let handle: Awaited<ReturnType<typeof open>>;
  let key: Buffer;
  try {
    key = await readFile(keyPath);
    handle = await open(bundlePath, "r");
  } catch {
    // The bundle is gone — purged or revoked between the policy read and now.
    return deny(res, tokenHash, req, "unknown");
  }

  await logEvent(tokenHash, "download_started", req);
  harden(res);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${policy.filename.replace(/"/g, "")}"`);

  const stream = openBundleStream(key, async (offset, length) => {
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, offset);
    return buf;
  });

  let sent = 0;
  stream.on("data", (chunk: Buffer) => {
    sent += chunk.length;
  });

  try {
    await new Promise<void>((resolve, reject) => {
      stream.on("error", reject);
      res.on("error", reject);
      res.on("close", () => (res.writableFinished ? resolve() : reject(new Error("client went away"))));
      stream.pipe(res);
    });
    /**
     * Only a *completed* transfer counts. A resumed download is several requests for the same
     * bundle, and counting requests would make "opens once" mean something the recipient never
     * agreed to (§10.7).
     */
    await writeState(tokenHash, { ...state, downloads: state.downloads + 1 });
    await logEvent(tokenHash, "download_completed", req, { bytes: sent });
  } catch {
    await logEvent(tokenHash, "denied", req, { reason: "interrupted", bytes: sent });
  } finally {
    await handle.close();
  }
}

/** Exported so the tests can drive it without binding a port. */
export function createShareServer() {
  return createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        harden(res);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(page("Something went wrong", "<h1>Something went wrong</h1><p>Try the link again in a moment.</p>", 500, res));
      } else {
        res.destroy();
      }
    });
  });
}

if (require.main === module) {
  createShareServer().listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`harbor-share listening on ${PORT}, serving ${ROOT}`);
  });
}
