import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openWith, sealWith } from "./crypto.service";

const key = randomBytes(32);

test("seal/open round-trips and binds AAD", () => {
  const pt = Buffer.from("passport number 123");
  const aad = Buffer.from("file:abc");
  const sealed = sealWith(key, pt, aad);
  assert.deepEqual(openWith(key, sealed, aad), pt);
  assert.throws(() => openWith(key, sealed, Buffer.from("file:other")));
});

test("a flipped ciphertext byte is rejected, not silently decrypted", () => {
  const sealed = sealWith(key, Buffer.from("hello"));
  sealed[sealed.length - 1] ^= 0x01;
  assert.throws(() => openWith(key, sealed));
});

test("a different key cannot open the payload", () => {
  const sealed = sealWith(key, Buffer.from("hello"));
  assert.throws(() => openWith(randomBytes(32), sealed));
});

test("every seal uses a fresh IV", () => {
  const a = sealWith(key, Buffer.from("x"));
  const b = sealWith(key, Buffer.from("x"));
  assert.notDeepEqual(a.subarray(0, 12), b.subarray(0, 12));
});
