import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, before, describe, test } from "node:test";
import { StoredZipWriter, hashSharePassword, sealBundle } from "@harbor/bundle";

/**
 * The doorman, driven end to end over real HTTP (spec §10.2, §10.6, §10.7).
 *
 * These are the promises a share makes to the person who sent it — the link burns only on a
 * click, a wrong password gives nothing away, a withdrawn share is gone immediately — so they are
 * tested against the running server rather than against its parts.
 */

let root: string;
let server: Server;
let base: string;

const SHARE_ID = "11111111-1111-4111-8111-111111111111";
const key = randomBytes(32);
let zipBytes: Buffer;

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function writeBundle(): Promise<void> {
  const dir = path.join(root, "bundles", SHARE_ID);
  await mkdir(dir, { recursive: true });

  const zipPath = path.join(root, "tmp.zip");
  const zh = await open(zipPath, "w+");
  const zip = new StoredZipWriter(zh, new Date("2026-09-14T10:00:00Z"));
  await zip.addFile("Reisepass.pdf", Readable.from([Buffer.from("%PDF-1.4 passport")]));
  await zip.addFile("Rechnung.pdf", Readable.from([Buffer.from("Rechnung über 248,10 €")]));
  const len = await zip.finish();
  await zh.close();
  zipBytes = await readFile(zipPath);

  const rh = await open(zipPath, "r");
  const bh = await open(path.join(dir, "bundle"), "w+");
  await sealBundle({ source: rh.createReadStream(), plaintextLength: len, dest: bh, key, padTo: 1024 * 1024 });
  await rh.close();
  await bh.close();
  await writeFile(path.join(dir, "key"), key);
}

async function writePolicy(token: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const dir = path.join(root, "links", hashOf(token));
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "policy.json"),
    JSON.stringify({
      shareId: SHARE_ID,
      filename: "2025 taxes.zip",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      maxDownloads: null,
      passwordHash: null,
      message: null,
      fileCount: 2,
      sealedBytes: 0,
      ...overrides,
    }),
  );
}

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "harbor-doorman-"));
  process.env.SHARE_DIR = root;
  process.env.SHARE_STATE_DIR = path.join(root, "state");
  await writeBundle();

  const { createShareServer } = (await import("./main")) as typeof import("./main");
  server = createShareServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

/**
 * The completion event is appended *after* the response has finished, so a client can see its
 * download complete a moment before the log does. That lag is harmless in production — a worker
 * reads the log on an interval — but a test that asserted immediately would be flaky.
 */
async function waitForEvent(token: string, event: string, timeoutMs = 2000): Promise<{ event: string; reason?: string }[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const log = await events(token);
    if (log.some((e) => e.event === event) || Date.now() > deadline) return log;
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function events(token: string): Promise<{ event: string; reason?: string }[]> {
  try {
    const raw = await readFile(path.join(root, "state", hashOf(token), "events.jsonl"), "utf8");
    return raw
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

describe("the doorman", () => {
  test("a GET hands over a page and never the documents", async () => {
    const token = "tok-preview-aaaaaaaaaaaaaaaaaaaa";
    await writePolicy(token);
    const res = await fetch(`${base}/s/${token}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    const body = await res.text();
    assert.match(body, /2 documents shared with you/);
    // A link previewer that fetched this has burned nothing.
    assert.deepEqual(
      (await events(token)).map((e) => e.event),
      ["viewed"],
    );
  });

  test("sets no cookie and hardens the response", async () => {
    const token = "tok-headers-bbbbbbbbbbbbbbbbbbbb";
    await writePolicy(token);
    const res = await fetch(`${base}/s/${token}`);
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  });

  test("a POST downloads the archive as an attachment", async () => {
    const token = "tok-download-cccccccccccccccccccc";
    await writePolicy(token);
    const res = await fetch(`${base}/s/${token}/download`, { method: "POST", body: new URLSearchParams() });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");
    assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="2025 taxes.zip"/);
    const body = Buffer.from(await res.arrayBuffer());
    // Byte for byte the archive that was sealed — padding and all, invisible to the recipient.
    assert.deepEqual(body, zipBytes);
    const log = (await waitForEvent(token, "download_completed")).map((e) => e.event);
    assert.deepEqual(log, ["download_started", "download_completed"]);
  });

  test("a one-time link is spent by the download, not by the preview", async () => {
    const token = "tok-onetime-dddddddddddddddddddd";
    await writePolicy(token, { maxDownloads: 1 });

    await fetch(`${base}/s/${token}`); // a previewer looks
    await fetch(`${base}/s/${token}`); // and another
    const first = await fetch(`${base}/s/${token}/download`, { method: "POST", body: new URLSearchParams() });
    assert.equal(first.status, 200);
    await first.arrayBuffer();

    const second = await fetch(`${base}/s/${token}/download`, { method: "POST", body: new URLSearchParams() });
    assert.equal(second.status, 404);
    const reasons = (await events(token)).filter((e) => e.event === "denied").map((e) => e.reason);
    assert.deepEqual(reasons, ["limit"]);
  });

  test("a wrong password is refused, and looks like nothing else", async () => {
    const token = "tok-password-eeeeeeeeeeeeeeeeeeee";
    await writePolicy(token, { passwordHash: await hashSharePassword("Ostsee-14-Blau") });

    const page = await (await fetch(`${base}/s/${token}`)).text();
    assert.match(page, /name="password"/);

    const wrong = await fetch(`${base}/s/${token}/download`, {
      method: "POST",
      body: new URLSearchParams({ password: "guess" }),
    });
    assert.equal(wrong.status, 401);

    const right = await fetch(`${base}/s/${token}/download`, {
      method: "POST",
      body: new URLSearchParams({ password: "Ostsee-14-Blau" }),
    });
    assert.equal(right.status, 200);
    assert.deepEqual(Buffer.from(await right.arrayBuffer()), zipBytes);
    assert.ok((await waitForEvent(token, "download_completed")).some((e) => e.event === "password_failed"));
  });

  test("an expired link is indistinguishable from one that never existed", async () => {
    const token = "tok-expired-ffffffffffffffffffff";
    await writePolicy(token, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const expired = await fetch(`${base}/s/${token}`);
    const unknown = await fetch(`${base}/s/tok-nothing-gggggggggggggggggggg`);
    assert.equal(expired.status, 404);
    assert.equal(unknown.status, 404);
    assert.equal(await expired.text(), await unknown.text());
    // The owner, however, is told which it was.
    assert.deepEqual(
      (await events(token)).map((e) => e.reason),
      ["expired"],
    );
  });

  test("revoking takes effect on the very next request", async () => {
    const token = "tok-revoke-hhhhhhhhhhhhhhhhhhhh";
    await writePolicy(token);
    assert.equal((await fetch(`${base}/s/${token}`)).status, 200);
    await rm(path.join(root, "links", hashOf(token)), { recursive: true, force: true });
    assert.equal((await fetch(`${base}/s/${token}`)).status, 404);
  });

  test("there is no route that lists anything", async () => {
    for (const p of ["/", "/s", "/s/", "/shares", "/../../etc/passwd", "/s/%2e%2e%2f%2e%2e%2fetc%2fpasswd"]) {
      const res = await fetch(`${base}${p}`);
      assert.ok(res.status === 404 || res.status === 400, `${p} answered ${res.status}`);
    }
  });
});
