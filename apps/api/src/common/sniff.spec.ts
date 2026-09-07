import { test } from "node:test";
import assert from "node:assert/strict";
import { sniffKind } from "./sniff";

test("sniffKind recognises the four supported kinds and nothing else", () => {
  assert.equal(sniffKind(Buffer.from("%PDF-1.7\n")), "pdf");
  assert.equal(sniffKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "jpeg");
  assert.equal(sniffKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "png");
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(8)]);
  assert.equal(sniffKind(heic), "heic");
  assert.equal(sniffKind(Buffer.from("PK not a pdf, a docx")), "unknown");
  assert.equal(sniffKind(Buffer.alloc(0)), "unknown");
});
