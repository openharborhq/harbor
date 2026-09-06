import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  TW_KEK_FILE: "/run/secrets/kek",
  TW_DATA_DIR: "/data",
};

test("loadEnv applies defaults", () => {
  const env = loadEnv(base);
  assert.equal(env.API_PORT, 4000);
  assert.equal(env.SESSION_COOKIE_SECURE, true);
  assert.equal(env.OCR_CONCURRENCY, 2);
});

test("loadEnv rejects a missing KEK path with a readable message", () => {
  const { TW_KEK_FILE: _omit, ...rest } = base;
  assert.throws(() => loadEnv(rest), /TW_KEK_FILE/);
});
