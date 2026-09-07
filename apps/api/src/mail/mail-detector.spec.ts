import { test } from "node:test";
import assert from "node:assert/strict";
import { PAPERWORK_TERMS, gmailFilterXml } from "./gmail-filter";
import { scanRangeFor } from "./mail-fetcher.service";
import { DEFAULT_CAPS, detect, filableAttachments, type SenderRule } from "./mail-detector";
import type { MailEnvelope, MailPart } from "./mail-source";

const pdf = (over: Partial<MailPart> = {}): MailPart => ({ part: "2", filename: "Rechnung_9912.pdf", mimeType: "application/pdf", size: 240_000, disposition: "attachment", contentId: null, ...over });
const body = (over: Partial<MailPart> = {}): MailPart => ({ part: "1", filename: null, mimeType: "text/html", size: 4_200, disposition: null, contentId: null, ...over });

const mail = (over: Partial<MailEnvelope> = {}): MailEnvelope => ({
  uid: 10,
  messageId: "<a@stadtwerke.de>",
  fromAddress: "rechnung@stadtwerke.de",
  fromName: "Stadtwerke",
  subject: "Ihre Rechnung für August",
  date: new Date("2026-08-14T09:00:00Z"),
  parts: [body(), pdf()],
  ...over,
});

const fileRule: SenderRule = { decision: "file", defaultCategorySlug: "real-estate/utilities", defaultItemLabels: ["Musterstraße 7"], defaultTags: [] };

test("an attachment from a sender you have never heard from files itself", () => {
  // The point of the redesign: a new billing relationship is exactly what an allowlist blocks,
  // and it is exactly what you most want caught.
  const d = detect(mail(), null);
  assert.equal(d.decision, "file");
  assert.equal(d.tier, 0, "the parts manifest alone decided this");
  assert.equal(d.attachments.length, 1);
  assert.equal(d.reason, null);
});

test("a routing rule adds where it goes, not whether it goes", () => {
  const d = detect(mail(), fileRule);
  assert.equal(d.decision, "file");
  assert.equal(d.tier, 2, "tier 2 only records that a rule had something to say");
  assert.equal(d.attachments[0]?.filename, "Rechnung_9912.pdf");
  assert.equal(d.rule, fileRule);
});

test("a muted sender is skipped even when they attach something", () => {
  const d = detect(mail(), { ...fileRule, decision: "ignore" });
  assert.equal(d.decision, "ignore");
  assert.equal(d.tier, 2);
  assert.deepEqual(d.attachments, [], "nothing is downloaded for a sender you muted");
  assert.match(d.reason ?? "", /muted/);
});

test("mail with nothing attached is left alone, whatever the subject says", () => {
  // "Your invoice is ready — log in to view" has no document in it. It is a reminder (§7.9,
  // deferred), and holding 58 of these was three-quarters of a review queue nobody read.
  for (const subject of ["Ihre Rechnung liegt bereit", "Your invoice is ready to view", "Dinner on Friday?"]) {
    const d = detect(mail({ parts: [body()], subject }), null);
    assert.equal(d.decision, "ignore", subject);
    assert.equal(d.tier, null, "tier null is what tells the fetcher not to write a row");
  }
});

test("caps are the only thing left that holds, and they say which cap was hit", () => {
  const huge = detect(mail({ parts: [pdf({ size: 40 * 1024 * 1024 })] }), fileRule);
  assert.equal(huge.decision, "hold");
  assert.match(huge.reason ?? "", /40 MB, over the 25 MB limit/);
  assert.deepEqual(huge.attachments, [], "an oversized attachment is not downloaded to find out");

  const many = detect(mail({ parts: Array.from({ length: 11 }, (_, i) => pdf({ part: String(i + 2), filename: `scan-${i}.pdf` })) }), fileRule);
  assert.equal(many.decision, "hold");
  assert.match(many.reason ?? "", /11 attachments, over the limit of 10/);
  assert.equal(DEFAULT_CAPS.maxAttachments, 10);
});

test("even a sender you file gets nothing filed when there is nothing attached", () => {
  const d = detect(mail({ parts: [body()], subject: "Your invoice is ready" }), fileRule);
  assert.equal(d.decision, "ignore", "an empty document would be worse than no document (§7.9)");
  assert.equal(d.attachments.length, 0);
});

test("inline decoration is not an attachment, however it is named", () => {
  // Straight from a real mailbox: Outlook names every image in an HTML body imageNNN.png and
  // gives it a filename, so "has a filename" accepted a whole Inbox of 356-byte social icons.
  const outlookSignature: MailPart[] = [
    body(),
    { part: "1.2", filename: "image001.png", mimeType: "image/png", size: 356, disposition: "inline", contentId: "<image001.png@01DA.4F2>" },
    { part: "1.3", filename: "image003.png", mimeType: "image/png", size: 356, disposition: null, contentId: "<image003.png@01DA.4F2>" },
    pdf(),
  ];
  assert.deepEqual(filableAttachments(outlookSignature).map((p) => p.filename), ["Rechnung_9912.pdf"], "only the attachment survives");

  // A Content-ID means the body points at it. Size is irrelevant: a photo pasted into a message
  // is still not something the sender attached.
  assert.deepEqual(filableAttachments([{ part: "2", filename: "image008.jpg", mimeType: "image/jpeg", size: 4_181_412, disposition: null, contentId: "<image008.jpg@01DA>" }]), []);

  // No disposition at all: a named PDF is unambiguous, a bare image is not.
  assert.equal(filableAttachments([{ part: "2", filename: "invoice.pdf", mimeType: "application/pdf", size: 90_000, disposition: null, contentId: null }]).length, 1);
  assert.equal(filableAttachments([{ part: "2", filename: "photo.jpg", mimeType: "image/jpeg", size: 90_000, disposition: null, contentId: null }]).length, 0);

  // A phone scan is a real attachment and must still get through (§2 stage 1).
  assert.equal(filableAttachments([{ part: "2", filename: "scan.heic", mimeType: "image/heic", size: 2_000_000, disposition: "attachment", contentId: null }]).length, 1);

  assert.deepEqual(filableAttachments([body()]), []);
});

test("the Gmail filter file imports cleanly and changes nothing about the inbox", () => {
  const xml = gmailFilterXml();
  assert.match(xml, /^<\?xml version='1.0' encoding='UTF-8'\?>/);
  assert.match(xml, /xmlns:apps='http:\/\/schemas.google.com\/apps\/2006'/);
  assert.match(xml, /name='label' value='Vault'/);
  for (const term of ["Rechnung", "invoice", "Zahlungsbest"]) assert.ok(xml.includes(term), `${term} is in the query`);
  assert.ok(!xml.includes("shouldArchive"), "the filter labels; it never archives someone's mail");
  assert.equal((xml.match(/<entry>/g) ?? []).length, 2, "one filter for attachments, one for subjects");

  const custom = gmailFilterXml({ label: "Papiere & Co" });
  assert.match(custom, /value='Papiere &amp; Co'/, "the label is XML-escaped");
  assert.ok(PAPERWORK_TERMS.includes("Rechnung"));
});

test("the folder cursor is trusted only while the server's numbering is", () => {
  const connectedAt = new Date("2026-09-01T00:00:00Z");
  const cursor = { uidValidity: 5000, lastUid: 812 };

  const resumed = scanRangeFor(cursor, 5000, connectedAt);
  assert.deepEqual(resumed.range, { sinceUid: 812 }, "same numbering: continue where the last pass stopped");
  assert.equal(resumed.lastUid, 812);

  const renumbered = scanRangeFor(cursor, 5001, connectedAt);
  assert.deepEqual(renumbered.range, { since: connectedAt }, "UIDVALIDITY changed: the old UIDs point at other messages now");
  assert.equal(renumbered.lastUid, 0, "and the cursor restarts rather than skipping ahead");

  const first = scanRangeFor(undefined, 5000, connectedAt);
  assert.deepEqual(first.range, { since: connectedAt }, "a new connection reads forward, never backward (§7.6)");
});
