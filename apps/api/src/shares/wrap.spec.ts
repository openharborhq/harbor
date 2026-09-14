import assert from "node:assert/strict";
import { createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { wrapKeyWithPassword } from "./shares.service";

/**
 * The `bucket` sink's password, which is not checked by a server but *unwraps the key* in the
 * recipient's browser (spec §10.10).
 *
 * These parameters are a contract with `landing-page.ts`: neither side can change PBKDF2's
 * iteration count, hash or salt length alone without silently breaking every link already sent.
 * This test is what makes that fail loudly instead.
 */
function unwrapLikeTheBrowser(fragment: string, password: string): Buffer {
  const [saltB64, ivB64, wrappedB64] = fragment.split(".");
  const salt = Buffer.from(saltB64, "base64url");
  const iv = Buffer.from(ivB64, "base64url");
  const wrapped = Buffer.from(wrappedB64, "base64url");
  const derived = pbkdf2Sync(password, salt, 600_000, 32, "sha256");
  const decipher = createDecipheriv("aes-256-gcm", derived, iv);
  decipher.setAuthTag(wrapped.subarray(wrapped.length - 16));
  return Buffer.concat([decipher.update(wrapped.subarray(0, wrapped.length - 16)), decipher.final()]);
}

describe("wrapKeyWithPassword", () => {
  test("round-trips the share key", async () => {
    const key = randomBytes(32);
    const fragment = await wrapKeyWithPassword(key, "Ostsee-14-Blau");
    assert.deepEqual(unwrapLikeTheBrowser(fragment, "Ostsee-14-Blau"), key);
  });

  test("a wrong password does not yield a key", async () => {
    const fragment = await wrapKeyWithPassword(randomBytes(32), "Ostsee-14-Blau");
    assert.throws(() => unwrapLikeTheBrowser(fragment, "Ostsee-14-Blao"));
  });

  test("the same key and password wrap differently every time", async () => {
    const key = randomBytes(32);
    const a = await wrapKeyWithPassword(key, "same");
    const b = await wrapKeyWithPassword(key, "same");
    assert.notEqual(a, b);
  });

  test("fits in a URL", async () => {
    const fragment = await wrapKeyWithPassword(randomBytes(32), "Ostsee-14-Blau");
    assert.ok(fragment.length < 200, `fragment was ${fragment.length} characters`);
    assert.match(fragment, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});
