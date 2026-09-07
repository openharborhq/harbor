import { test } from "node:test";
import assert from "node:assert/strict";
import { displayTitle, titleFromFilename, type DocumentSummary } from "@harbor/shared";

/**
 * One rule decides what a document is called on screen, because two rules is how the Inbox came
 * to show "Spotify Premium Family Receipt" while the document it opened showed the filename.
 */
const doc = (title: string, originalFilename: string, suggested?: string | null, resolved?: Partial<{ acceptedAt: string; rejectedAt: string }>): Parameters<typeof displayTitle>[0] =>
  ({
    title,
    file: { originalFilename } as DocumentSummary["file"],
    suggestion: suggested
      ? ({
          payload: { title: suggested },
          acceptedAt: resolved?.acceptedAt ?? null,
          rejectedAt: resolved?.rejectedAt ?? null,
        } as DocumentSummary["suggestion"])
      : null,
  }) as Parameters<typeof displayTitle>[0];

test("a filename-derived title gives way to a pending suggestion", () => {
  // Real examples from a connected mailbox.
  assert.equal(displayTitle(doc("f0a3c7bf 4cbf 4904 a665 6205f2c36ecd", "f0a3c7bf-4cbf-4904-a665-6205f2c36ecd.pdf", "Spotify Premium Family Receipt")), "Spotify Premium Family Receipt");
  assert.equal(displayTitle(doc("INV 2026 00417", "INV-2026-00417.pdf", "Starlink Internet Invoice — 100 Mbps")), "Starlink Internet Invoice — 100 Mbps");
});

test("a title someone chose is never overridden by the model", () => {
  // The case that makes the rule necessary: rename it, and the suggestion stops winning — so an
  // edit cannot be silently undone by a suggestion that is still sitting there unaccepted.
  assert.equal(displayTitle(doc("Handover inspection — Musterstraße 7", "R-2026-0147.pdf", "Invoice: Handover Inspection Musterstraße 7")), "Handover inspection — Musterstraße 7");
});

test("a resolved suggestion stops applying either way", () => {
  const filename = "f0a3c7bf-4cbf-4904-a665-6205f2c36ecd.pdf";
  const stored = titleFromFilename(filename);
  assert.equal(displayTitle(doc(stored, filename, "Spotify Premium Family Receipt", { acceptedAt: "2026-09-07T00:00:00.000Z" })), stored, "accepting copies the title onto the document; the suggestion stops being the source");
  assert.equal(displayTitle(doc(stored, filename, "Spotify Premium Family Receipt", { rejectedAt: "2026-09-07T00:00:00.000Z" })), stored, "a rejected suggestion is not quietly still in charge");
  assert.equal(displayTitle(doc(stored, filename, null)), stored, "no suggestion, no change");
  assert.equal(displayTitle(doc(stored, filename, "   ")), stored, "an empty suggested title is not a title");
});

test("titleFromFilename strips the path and extension the same way intake does", () => {
  assert.equal(titleFromFilename("INV-2026-00417.pdf"), "INV 2026 00417");
  assert.equal(titleFromFilename("/tmp/uploads/Rechnung_2026-08.pdf"), "Rechnung 2026 08");
  assert.equal(titleFromFilename(".pdf"), "Untitled document", "a name that reduces to nothing still needs one");
  assert.ok(titleFromFilename("x".repeat(300)).length <= 120);
});
