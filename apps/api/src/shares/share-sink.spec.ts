import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
