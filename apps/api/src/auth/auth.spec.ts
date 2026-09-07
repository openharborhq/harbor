import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "./rate-limiter";
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from "./recovery-codes";

test("rate limiter blocks the (max+1)th hit inside the window and frees after it", () => {
  let t = 0;
  const rl = new RateLimiter(3, 1000, () => t);
  assert.ok(rl.allow("k"));
  assert.ok(rl.allow("k"));
  assert.ok(rl.allow("k"));
  assert.equal(rl.allow("k"), false);
  t = 1001;
  assert.ok(rl.allow("k"));
});

test("recovery codes: 10 unique, printable, and matched case/dash-insensitively", () => {
  const { codes, hashes } = generateRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const typed = codes[0]!.toLowerCase().replace(/-/g, " ");
  assert.equal(normalizeRecoveryCode(typed), normalizeRecoveryCode(codes[0]!));
  assert.equal(hashRecoveryCode(typed), hashes[0]);
});
