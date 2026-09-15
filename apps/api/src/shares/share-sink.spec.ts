import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { DoormanSink } from "./share-sink";

/**
 * The guard against a box running new images with an older stack (§10.2).
 *
 * Worth a test because the failure it prevents is silent: the API container is not read-only, so
 * writing a bundle into a missing mount succeeds, and the share is only discovered to be gone
 * later — by the recipient.
 */
function sinkFor(dataDir: string): DoormanSink {
  return new DoormanSink({ get: () => dataDir } as unknown as ConstructorParameters<typeof DoormanSink>[0]);
}

describe("assertOnDataVolume", () => {
  test("passes when the share directory sits on the data volume", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harbor-mount-"));
    try {
      const sink = sinkFor(dir);
      await sink.onModuleInit();
      // Both under the same temp root, so the same device — the healthy case.
      await sink.assertOnDataVolume(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("refuses, in the operator's words, when it does not", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harbor-mount-"));
    try {
      const sink = sinkFor(dir);
      await sink.onModuleInit();
      // /dev is a different filesystem on both Linux and macOS: the stand-in for a bind mount the
      // container does not have.
      await assert.rejects(
        () => sink.assertOnDataVolume("/dev"),
        (err: Error) => {
          assert.match(err.message, /not part of the data volume/);
          assert.match(err.message, /harbor upgrade/);
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Where a bundle is sealed decides whether it can be put away (§10.2).
 *
 * `/data/tmp` and `/data/shares` are one filesystem and two bind mounts, and a rename across a
 * mount boundary fails with EXDEV however alike the two sides are. Every share on the appliance
 * returned a 500 on exactly this (2026-09-15). What the test can pin without two real mounts is
 * the property that avoids it: the staging path is inside the directory the bundle ends up in.
 */
describe("newStagingPath", () => {
  test("stages inside the bundle directory, so putting it away never crosses a mount", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harbor-staging-"));
    try {
      const sink = sinkFor(dir);
      await sink.onModuleInit();
      const staged = sink.newStagingPath();
      assert.equal(path.dirname(staged), path.join(sink.root, "bundles"));
      // The doorman reads bundles/<shareId>/bundle. A staged file is a sibling of those
      // directories rather than one of them, and dotted, so it can never be served half-written.
      assert.ok(path.basename(staged).startsWith("."));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("putBundle moves a staged bundle into place with its key", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harbor-staging-"));
    try {
      const sink = sinkFor(dir);
      await sink.onModuleInit();
      const staged = sink.newStagingPath();
      await writeFile(staged, "sealed-bytes");

      await sink.putBundle("share-1", staged, Buffer.from("key-bytes"));

      assert.equal(await readFile(sink.bundlePath("share-1"), "utf8"), "sealed-bytes");
      assert.equal(await readFile(path.join(sink.bundleDir("share-1"), "key"), "utf8"), "key-bytes");
      // Nothing left behind for the next `ls` of the bundles directory to puzzle over.
      await assert.rejects(() => readFile(staged));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
