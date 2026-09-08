import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, isNewer } from "./version.service";
import { parseChangelog, readBundledChangelog } from "./changelog";

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

test("parseChangelog splits releases on their headings", () => {
  const entries = parseChangelog(
    [
      "# Changelog",
      "",
      "Preamble that belongs to no release.",
      "",
      "## v0.2.0 — 2026-09-08",
      "",
      "- A QR code when enrolling.",
      "",
      "## v0.1.0 — 2026-09-07",
      "",
      "First tagged release.",
      "",
    ].join("\n"),
  );
  assert.deepEqual(
    entries.map((e) => e.version),
    ["v0.2.0", "v0.1.0"],
  );
  assert.equal(entries[0].date, "2026-09-08");
  assert.equal(entries[0].body, "- A QR code when enrolling.");
  assert.equal(entries[1].body, "First tagged release.");
});

test("parseChangelog keeps a release whose heading has no date, and ignores other headings", () => {
  const entries = parseChangelog(["## v1.0.0", "", "### Worth knowing", "", "Something.", ""].join("\n"));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, null);
  assert.equal(entries[0].body, "### Worth knowing\n\nSomething.");
});

test("the changelog shipped in this repo parses, so the notes are never silently empty", () => {
  const entries = readBundledChangelog();
  assert.ok(entries.length > 0, "expected CHANGELOG.md to yield at least one release");
  assert.match(entries[0].version, /^v\d+\.\d+\.\d+$/);
  assert.ok(entries[0].body.length > 0);
});
