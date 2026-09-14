import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_PRESIGN_SECONDS, presignGet, signPut, type S3Credentials } from "./sigv4";

/**
 * AWS publishes worked examples for SigV4, and this is the one for a presigned S3 GET. It pins
 * every part of the algorithm at once — canonical request, scope, the key-derivation chain — so a
 * mistake anywhere changes the signature. Without it, a wrong implementation would look fine
 * locally and fail only against a real store.
 */
const AWS_EXAMPLE: S3Credentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  endpoint: "https://examplebucket.s3.amazonaws.com",
  bucket: "",
};

describe("presignGet", () => {
  test("matches AWS's published example signature", () => {
    const url = presignGet(
      { ...AWS_EXAMPLE, bucket: "" },
      "test.txt",
      86400,
      new Date("2013-05-24T00:00:00Z"),
    );
    assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404/);
  });

  test("refuses to sign for longer than the protocol allows", () => {
    assert.throws(
      () => presignGet({ ...AWS_EXAMPLE, bucket: "b" }, "k", MAX_PRESIGN_SECONDS + 1),
      /cannot outlive/,
    );
  });

  test("escapes a key the way S3 expects, without escaping its slashes", () => {
    const url = presignGet({ ...AWS_EXAMPLE, bucket: "b" }, "a b/c+d/Rechnung – 2025.pdf", 3600, new Date("2026-09-14T00:00:00Z"));
    assert.match(url, /\/b\/a%20b\/c%2Bd\/Rechnung%20%E2%80%93%202025\.pdf\?/);
  });

  test("two shares signed a second apart do not collide", () => {
    const a = presignGet({ ...AWS_EXAMPLE, bucket: "b" }, "one", 3600, new Date("2026-09-14T00:00:00Z"));
    const b = presignGet({ ...AWS_EXAMPLE, bucket: "b" }, "two", 3600, new Date("2026-09-14T00:00:01Z"));
    assert.notEqual(a, b);
  });
});

describe("signPut", () => {
  test("signs the body, so a mangled upload is rejected rather than stored", () => {
    const one = signPut({ ...AWS_EXAMPLE, bucket: "b" }, "k", Buffer.from("hello"), "application/octet-stream", new Date("2026-09-14T00:00:00Z"));
    const two = signPut({ ...AWS_EXAMPLE, bucket: "b" }, "k", Buffer.from("hellp"), "application/octet-stream", new Date("2026-09-14T00:00:00Z"));
    assert.notEqual(one.headers.Authorization, two.headers.Authorization);
    assert.match(one.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20260914\/us-east-1\/s3\/aws4_request/);
    assert.equal(one.headers["x-amz-content-sha256"].length, 64);
  });
});
