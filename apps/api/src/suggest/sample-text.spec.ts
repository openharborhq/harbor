import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PAGE_BREAK, sampleText } from "./sample-text";

const page = (label: string, chars: number) => label.repeat(Math.ceil(chars / label.length)).slice(0, chars);

describe("sampling a document for the model", () => {
  it("sends a short document whole, and says so", () => {
    const doc = `${page("a", 200)}${PAGE_BREAK}${page("b", 200)}`;
    const out = sampleText(doc, 24_000);
    assert.equal(out.truncated, false);
    assert.equal(out.pages, 2);
    assert.equal(out.text, doc.trim());
  });

  it("reaches every page of a long scan", () => {
    // The bug this exists to prevent: at ~7k characters a page, a flat 4k head-slice never
    // reached page two of anything, and 44% of the vault is longer than that.
    const doc = ["one", "two", "three", "four", "five", "six"].map((m) => page(m, 7_000)).join(PAGE_BREAK);
    const out = sampleText(doc, 24_000);
    assert.equal(out.truncated, true);
    assert.equal(out.pages, 6);
    for (const marker of ["one", "two", "three", "four", "five", "six"]) {
      assert.ok(out.text.includes(marker.repeat(2)), `page "${marker}" is missing from the sample`);
    }
    assert.ok(out.text.length <= 24_000 + 400, "the page labels should not blow the budget");
  });

  it("hands a short page's unused share to the pages that need it", () => {
    const doc = [page("s", 100), page("L", 40_000)].join(PAGE_BREAK);
    const out = sampleText(doc, 10_000);
    // The covering note is complete, and nearly the whole budget went to the invoice behind it.
    assert.ok(out.text.includes(page("s", 100)));
    assert.ok(out.text.split("L").length - 1 > 9_000);
  });

  it("keeps the end of the last page, where the total and the IBAN live", () => {
    const long = `${page("x", 20_000)}TOTAL-DUE-2026-10-14`;
    const out = sampleText(`${page("a", 300)}${PAGE_BREAK}${long}`, 6_000);
    assert.ok(out.text.includes("TOTAL-DUE-2026-10-14"), "the tail of the final page was dropped");
  });

  it("marks every cut it makes", () => {
    const out = sampleText(page("z", 50_000), 4_000);
    assert.equal(out.pages, 1);
    assert.equal(out.truncated, true);
    assert.ok(out.text.includes("[…]"));
  });

  it("survives an empty extraction", () => {
    assert.deepEqual(sampleText("   "), { text: "", truncated: false, pages: 0 });
  });
});
