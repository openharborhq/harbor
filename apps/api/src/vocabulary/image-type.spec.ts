import { test } from "node:test";
import assert from "node:assert/strict";
import { sniffImage } from "./image-type";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const webp = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBP", "latin1")]);

test("the three formats the vault accepts are recognised by their own bytes", () => {
  assert.equal(sniffImage(png), "image/png");
  assert.equal(sniffImage(jpeg), "image/jpeg");
  assert.equal(sniffImage(webp), "image/webp");
});

test("anything else is refused, however it labels itself", () => {
  assert.equal(sniffImage(Buffer.from("%PDF-1.7\n", "latin1")), null);
  assert.equal(sniffImage(Buffer.from("GIF89a", "latin1")), null);
  assert.equal(sniffImage(Buffer.from("<svg xmlns=", "latin1")), null, "SVG is markup that a browser will execute");
  assert.equal(sniffImage(Buffer.alloc(0)), null);
  // RIFF is also the container for WAV; only WEBP inside it is an image.
  assert.equal(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")])), null);
});
