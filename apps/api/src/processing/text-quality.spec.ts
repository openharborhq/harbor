import { test } from "node:test";
import assert from "node:assert/strict";
import { hasUsableTextLayer, pageFromOcrLine, pagesFromPdfInfo } from "./text-quality";

test("a born-digital page has a usable text layer; a scan does not; a junk layer does not", () => {
  const page = "Stadtwerke München GmbH Rechnung Stromlieferung August 2026 Zählerstand 24118 kWh Betrag 84,20 EUR fällig 15.09.2026 ".repeat(3);
  assert.equal(hasUsableTextLayer(page, 1), true);
  assert.equal(hasUsableTextLayer("", 1), false);
  assert.equal(hasUsableTextLayer("FAX COVER", 3), false);
  assert.equal(hasUsableTextLayer(page, 0), false);
});

test("ocrmypdf progress lines and pdfinfo page counts parse", () => {
  assert.equal(pageFromOcrLine("   7: [tesseract] recognising"), 7);
  assert.equal(pageFromOcrLine("Scanning contents: 100%"), null);
  assert.equal(pagesFromPdfInfo("Title:  x\nPages:          12\nEncrypted: no"), 12);
  assert.equal(pagesFromPdfInfo("garbage"), null);
});
