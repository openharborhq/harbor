import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  HARBOR_KEK_FILE: "/run/secrets/kek",
  HARBOR_DATA_DIR: "/data",
};

test("loadEnv applies defaults", () => {
  const env = loadEnv(base);
  assert.equal(env.API_PORT, 4000);
  assert.equal(env.SESSION_COOKIE_SECURE, true);
  assert.equal(env.OCR_CONCURRENCY, 2);
});

test("loadEnv rejects a missing KEK path with a readable message", () => {
  const { HARBOR_KEK_FILE: _omit, ...rest } = base;
  assert.throws(() => loadEnv(rest), /HARBOR_KEK_FILE/);
});

test("an empty optional variable is the same as an unset one", () => {
  // Compose passes `${SUGGEST_BASE_URL:-}` as "", and "" is not a URL. This is how the suggester
  // container crash-looped on a variable nobody had set.
  const base = { DATABASE_URL: "postgres://h:h@db:5432/h", REDIS_URL: "redis://r:6379", HARBOR_KEK_FILE: "/run/secrets/kek", HARBOR_DATA_DIR: "/data" };
  const env = loadEnv({ ...base, SUGGEST_BASE_URL: "", SUGGEST_API_KEY_FILE: "", ANTHROPIC_API_KEY_FILE: "" });
  assert.equal(env.SUGGEST_BASE_URL, undefined);
  assert.equal(env.SUGGEST_API_KEY_FILE, undefined);
  // A real value still validates as before.
  assert.throws(() => loadEnv({ ...base, SUGGEST_BASE_URL: "not a url" }), /SUGGEST_BASE_URL/);
});
