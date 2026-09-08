import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, isNewer } from "./version.service";

test("versions order numerically, not as strings", () => {
  assert.ok(compareVersions("v0.2.0", "v0.1.0") > 0);
  assert.ok(compareVersions("v0.10.0", "v0.9.0") > 0, "10 is after 9, which string sorting gets wrong");
  assert.ok(compareVersions("v1.0.0", "v0.99.99") > 0);
  assert.equal(compareVersions("v0.2.0", "v0.2.0"), 0);
});

test("an update is offered only when there really is one", () => {
  assert.equal(isNewer("v0.2.0", "v0.1.0"), true);
  assert.equal(isNewer("v0.2.0", "v0.2.0"), false);
  assert.equal(isNewer("v0.1.0", "v0.2.0"), false, "never offer a downgrade");
});

test("a hand-built image is off the map, not behind", () => {
  // `dev` means somebody built this themselves; telling them to upgrade to a release would
  // replace their own build without warning.
  assert.equal(isNewer("v9.9.9", "dev"), false);
  assert.equal(isNewer("v9.9.9", "main-abc1234"), false);
});
