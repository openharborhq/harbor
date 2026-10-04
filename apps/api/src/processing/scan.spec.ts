import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScanResult } from "./scan";

test("a cleaned photo's report parses; a refusal or a broken one means no scan", () => {
  assert.deepEqual(parseScanResult('{"cleaned": true, "outline": "partial", "folds": 2, "dpi": 358, "width": 2960, "height": 3985}\n'), {
    outline: "partial",
    folds: 2,
    dpi: 358,
  });
  assert.equal(parseScanResult('{"cleaned": false, "outline": "none"}'), null);
  assert.equal(parseScanResult(""), null);
  assert.equal(parseScanResult("Traceback (most recent call last):"), null);
  assert.equal(parseScanResult('{"cleaned": true, "outline": "crumpled", "dpi": 300}'), null);
  assert.equal(parseScanResult('{"cleaned": true, "outline": "page", "dpi": 0}'), null);
});

test("only the last line counts, so a library's chatter on stdout does no harm", () => {
  assert.equal(parseScanResult('[ WARN:0] something\n{"cleaned": true, "outline": "page", "folds": 0, "dpi": 241}')?.dpi, 241);
});
