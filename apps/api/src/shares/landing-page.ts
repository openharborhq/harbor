/**
 * The page a `bucket` share is opened with (spec §10.10).
 *
 * One self-contained HTML file per share, uploaded beside its bundle. No framework, no external
 * script, nothing fetched from anywhere but the bundle sitting next to it in the same bucket —
 * which is why both objects go in one bucket: same origin, so the owner is never asked to write a
 * CORS rule.
 *
 * The key rides in the URL **fragment**, which browsers never put on the wire. The store therefore
 * serves a page and some ciphertext and is not in a position to read either. That is the whole
 * security argument for this sink, and it holds only as long as nothing here sends the fragment
 * anywhere — so this page makes exactly one request, to a URL that was baked in before it was
 * written.
 *
 * Two honest deviations from §10.10, both forced by what a browser actually has:
 *
 *  - **PBKDF2, not argon2id**, for a password-protected share. Argon2 in a browser means shipping
 *    a WebAssembly build, which is a third-party dependency on the one page that must not have
 *    any. PBKDF2-SHA256 at 600,000 iterations is what Web Crypto offers natively. It is weaker
 *    per guess than argon2id, and the spec's warning stands: this is offline-brute-forceable by
 *    whoever holds the ciphertext, so the wording asks for a password that will not be guessed
 *    rather than promising protection.
 *  - **Assembled in memory unless the browser can stream to disk.** Chunks are decrypted one at a
 *    time — Web Crypto's one-shot `decrypt` could not do even that over a whole bundle — but
 *    handing the result to the user without `showSaveFilePicker` means a Blob. Where that API
 *    exists (Chromium), the plaintext goes straight to the chosen file and never accumulates.
 */

export interface LandingPageOptions {
  /** Presigned GET for the bundle, expiring with the share. */
  bundleUrl: string;
  filename: string;
  fileCount: number;
  message: string | null;
  expiresAt: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function landingPage(opts: LandingPageOptions): string {
  const files = `${opts.fileCount} document${opts.fileCount === 1 ? "" : "s"}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Documents shared with you</title><style>
/* The same values as the app and the site, not a third set that is nearly them. This page had its
   own dark palette first, and every one of its seven colours had drifted a shade or two from the
   ones Harbor uses elsewhere — near-identical is the expensive kind of different (2026-09-15).
   --fill is cobalt in both themes: white on the lifted --accent is 2.44:1, so the download button
   was close to unreadable at night on the one page a stranger ever sees. */
:root{color-scheme:light dark;--ground:#fff;--surface:#f2f5f9;--border:#dce3ec;--text:#0d1622;--muted:#586471;--accent:#123fa8;--danger:#a33125;--fill:#123fa8}
@media(prefers-color-scheme:dark){:root{--ground:#0f1723;--surface:#162031;--border:#243349;--text:#e6ecf5;--muted:#a7b4c6;--accent:#7ea6ff;--danger:#f08375}}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--text);font:15px/22px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:520px;margin:0 auto;padding:48px 20px}
.card{background:var(--ground);border:1px solid var(--border);border-radius:18px;padding:28px}
h1{font-size:24px;line-height:30px;letter-spacing:-.02em;margin:0 0 8px}
p{margin:0 0 14px;color:var(--muted)}p.lead{color:var(--text)}
.meta{font-size:13px;margin:0 0 20px}
label{display:block;font-size:13px;font-weight:600;margin:0 0 6px;color:var(--text)}
input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--ground);color:var(--text);margin-bottom:16px}
button{font:inherit;font-weight:600;background:var(--fill);color:#fff;border:0;border-radius:8px;padding:11px 20px;cursor:pointer}
button[disabled]{opacity:.5;cursor:default}
.err{color:var(--danger);font-size:13px;margin:0 0 14px}
progress{width:100%;height:6px;margin:4px 0 12px}
footer{margin-top:22px;font-size:12px;color:var(--muted);text-align:center}
</style></head><body><main><div class="card">
<h1>${esc(files)} shared with you</h1>
${opts.message ? `<p class="lead">${esc(opts.message)}</p>` : ""}
<p class="meta">Available until <span id="until"></span>.</p>
<div id="pw" hidden>
  <label for="password">Password</label>
  <input id="password" type="password" autocomplete="off">
</div>
<p class="err" id="error" hidden></p>
<progress id="bar" hidden></progress>
<p id="status" hidden></p>
<button id="go" type="button">Download</button>
</div>
<footer>Decrypted in this browser. Sent with Harbor.</footer></main>
<script>
(function () {
  var BUNDLE_URL = ${JSON.stringify(opts.bundleUrl)};
  var FILENAME = ${JSON.stringify(opts.filename)};
  var EXPIRES = ${JSON.stringify(opts.expiresAt)};
  var MAGIC = "HBRS1", HEADER = 17, IV = 12, TAG = 16;

  var el = function (id) { return document.getElementById(id); };
  el("until").textContent = new Date(EXPIRES).toLocaleString();

  function fail(message) {
    var e = el("error");
    e.textContent = message;
    e.hidden = false;
    el("go").disabled = false;
    el("bar").hidden = true;
    el("status").hidden = true;
  }

  function b64urlToBytes(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // The fragment never leaves this browser. #k= is the key itself; #w= is the key wrapped under a
  // password, which then has to be typed to unwrap it.
  var frag = new URLSearchParams(location.hash.slice(1));
  var rawKey = frag.get("k");
  var wrapped = frag.get("w");
  if (!rawKey && !wrapped) fail("This link is missing its key. Copy the whole link, including the part after the # sign.");
  if (wrapped) el("pw").hidden = false;

  async function keyFromPassword() {
    var parts = wrapped.split(".");
    if (parts.length !== 3) throw new Error("This link is damaged.");
    var salt = b64urlToBytes(parts[0]), iv = b64urlToBytes(parts[1]), blob = b64urlToBytes(parts[2]);
    var pw = el("password").value;
    if (!pw) throw new Error("Type the password you were given.");
    var base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    var unwrapper = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: 600000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
    );
    var keyBytes;
    try {
      keyBytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, unwrapper, blob);
    } catch (e) {
      throw new Error("That password is not right.");
    }
    return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  }

  async function run() {
    el("go").disabled = true;
    el("error").hidden = true;
    el("status").hidden = false;
    el("status").textContent = "Fetching…";

    var key;
    try {
      key = wrapped ? await keyFromPassword() : await crypto.subtle.importKey("raw", b64urlToBytes(rawKey), "AES-GCM", false, ["decrypt"]);
    } catch (e) { return fail(e.message); }

    var buf;
    try {
      var res = await fetch(BUNDLE_URL);
      if (!res.ok) throw new Error(res.status === 403 ? "This link has expired." : "The file could not be fetched (" + res.status + ").");
      buf = new Uint8Array(await res.arrayBuffer());
    } catch (e) { return fail(e.message || "The file could not be fetched."); }

    var head = buf.subarray(0, HEADER);
    if (String.fromCharCode.apply(null, head.subarray(0, 5)) !== MAGIC) return fail("This does not look like a Harbor share.");
    var view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    var chunkSize = view.getUint32(5);
    var total = Number(view.getBigUint64(9));
    var chunks = Math.max(1, Math.ceil(total / chunkSize));

    // Stream straight to disk where the browser allows it; otherwise the plaintext has to be
    // assembled before it can be handed over.
    var sink = null, parts = [];
    if (window.showSaveFilePicker) {
      try {
        var handle = await window.showSaveFilePicker({ suggestedName: FILENAME });
        sink = await handle.createWritable();
      } catch (e) { if (e && e.name === "AbortError") { el("go").disabled = false; el("status").hidden = true; return; } }
    }

    el("bar").hidden = false;
    el("bar").max = chunks;
    var offset = HEADER, left = total;
    for (var i = 0; i < chunks; i++) {
      var body = Math.min(chunkSize, left);
      var iv = buf.subarray(offset, offset + IV);
      // The bundle stores iv || tag || ciphertext, which is Node's layout. Web Crypto wants the
      // tag *appended* to the ciphertext, so the two halves are swapped before decrypting. Getting
      // this wrong fails as "did not decrypt", which is why it is spelled out here.
      var tag = buf.subarray(offset + IV, offset + IV + TAG);
      var ct = buf.subarray(offset + IV + TAG, offset + IV + TAG + body);
      var payload = new Uint8Array(ct.length + TAG);
      payload.set(ct, 0);
      payload.set(tag, ct.length);
      // Every chunk is bound to the header and its own index, so a reordered or lifted chunk
      // fails here rather than producing a plausible archive.
      var aad = new Uint8Array(HEADER + 8);
      aad.set(head, 0);
      new DataView(aad.buffer).setBigUint64(HEADER, BigInt(i));
      var plain;
      try {
        plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv, additionalData: aad }, key, payload);
      } catch (e) {
        if (sink) await sink.abort().catch(function () {});
        return fail("This file did not decrypt. The link may be damaged, or the password wrong.");
      }
      if (sink) await sink.write(new Uint8Array(plain)); else parts.push(new Uint8Array(plain));
      offset += IV + TAG + body;
      left -= body;
      el("bar").value = i + 1;
      el("status").textContent = "Decrypting… " + Math.round(((i + 1) / chunks) * 100) + "%";
    }

    if (sink) {
      await sink.close();
    } else {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(parts, { type: "application/zip" }));
      a.download = FILENAME;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
    }
    el("status").textContent = "Saved " + FILENAME;
    el("bar").hidden = true;
  }

  el("go").addEventListener("click", function () { run(); });
})();
</script>
</body></html>`;
}
