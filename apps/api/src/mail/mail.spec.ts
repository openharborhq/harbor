import { test } from "node:test";
import assert from "node:assert/strict";
import { AutodiscoverService, applyUsername, parseIspdb } from "./autodiscover.service";
import { toEnvelope } from "./imap.source";
import { MailConnectionsService, explain } from "./mail-connections.service";
import { flattenParts, isFilableFolder, normaliseFolderName, type BodyStructureNode, type MailSource, type MailSourceConfig } from "./mail-source";

const ISPDB = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="example.com">
    <domain>example.com</domain>
    <incomingServer type="pop3">
      <hostname>pop.example.com</hostname><port>995</port><socketType>SSL</socketType>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.example.com</hostname><port>143</port><socketType>plain</socketType>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.example.com</hostname><port>993</port><socketType>SSL</socketType>
      <username>%EMAILLOCALPART%</username>
    </incomingServer>
  </emailProvider>
</clientConfig>`;

test("ISPDB: the first IMAP server offering TLS wins; a cleartext one is skipped", () => {
  const parsed = parseIspdb(ISPDB);
  assert.ok(parsed);
  assert.equal(parsed.host, "imap.example.com");
  assert.equal(parsed.port, 993, "the plain-socket block on 143 is not usable (§7.2)");
  assert.equal(parsed.usernameForm, "%EMAILLOCALPART%");
  assert.equal(parseIspdb("<clientConfig></clientConfig>"), null);
  assert.equal(parseIspdb("not xml at all"), null, "a malformed reply misses rather than throws");
});

test("username placeholders are filled from the address", () => {
  assert.equal(applyUsername("%EMAILADDRESS%", "anna@example.com"), "anna@example.com");
  assert.equal(applyUsername("%EMAILLOCALPART%", "anna@example.com"), "anna");
  assert.equal(applyUsername("fixed", "anna@example.com"), "fixed");
});

test("autodiscover answers known providers without a network call, and names Microsoft", async () => {
  const service = new AutodiscoverService();

  const gmail = await service.discover("anna@gmail.com");
  assert.ok(gmail && !gmail.unsupported);
  assert.equal(gmail.host, "imap.gmail.com");
  assert.equal(gmail.username, "anna@gmail.com");
  assert.equal(gmail.source, "builtin");
  assert.match(gmail.appPasswordNote ?? "", /2-Step/, "the prerequisite people trip over is stated up front");

  const outlook = await service.discover("anna@outlook.com");
  assert.ok(outlook && outlook.unsupported, "Microsoft is named at the form, not left to fail at login (§7.2)");
  assert.match(outlook.alternative, /[Ff]orward/);

  assert.equal(await service.discover("not-an-address"), null);
});

test("BODYSTRUCTURE gives up its attachments without a body being fetched", () => {
  const multipart: BodyStructureNode = {
    type: "multipart/mixed",
    childNodes: [
      { part: "1", type: "multipart/alternative", childNodes: [
        { part: "1.1", type: "text/plain", size: 800 },
        { part: "1.2", type: "text/html", size: 4200 },
      ] },
      { part: "2", type: "application/pdf", size: 245_000, disposition: "attachment", dispositionParameters: { filename: "Rechnung_9912.pdf" } },
    ],
  };
  const parts = flattenParts(multipart);
  assert.deepEqual(parts.map((p) => p.part), ["1.1", "1.2", "2"], "containers are structure, only leaves are content");

  const pdf = parts.find((p) => p.mimeType === "application/pdf");
  assert.equal(pdf?.filename, "Rechnung_9912.pdf");
  assert.equal(pdf?.size, 245_000);

  const single = flattenParts({ type: "text/plain", size: 120 });
  assert.deepEqual(single.map((p) => p.part), ["1"], "a single-part message is part 1");
  assert.deepEqual(flattenParts(undefined), []);
});

test("folders nobody files out of are skipped, by flag or by name in either language", () => {
  assert.equal(isFilableFolder({ path: "INBOX" }), true);
  assert.equal(isFilableFolder({ path: "Rechnungen" }), true);
  assert.equal(isFilableFolder({ path: "[Gmail]/Trash", name: "Trash", specialUse: "\\Trash" }), false);
  assert.equal(isFilableFolder({ path: "Papierkorb", name: "Papierkorb" }), false);
  assert.equal(isFilableFolder({ path: "Spam", name: "Spam" }), false);
  assert.equal(isFilableFolder({ path: "INBOX.Entwürfe", name: "Entwürfe" }), false);
});

test("junk folders whose names carry punctuation are skipped too", () => {
  // From a real Gmail account: an Outlook-era name Gmail sets no special-use flag on, which an
  // exact-match list let through to the backfill — and the backfill reads every folder.
  assert.equal(isFilableFolder({ path: "Junk E-mail", name: "Junk E-mail" }), false);
  assert.equal(isFilableFolder({ path: "Junk E-Mail", name: "Junk E-Mail" }), false);
  assert.equal(isFilableFolder({ path: "Deleted Items", name: "Deleted Items" }), false);
  assert.equal(isFilableFolder({ path: "Gelöschte Elemente", name: "Gelöschte Elemente" }), false);
  assert.equal(normaliseFolderName("Junk E-mail"), "junkemail");

  // Sent mail: found on a real mailbox, where 22 of 159 backfill candidates turned out to be the
  // account owner's own outgoing attachments, making them the top sender in the review.
  assert.equal(isFilableFolder({ path: "[Gmail]/Sent Mail", name: "Sent Mail", specialUse: "\\Sent" }), false);
  assert.equal(isFilableFolder({ path: "Sent Items", name: "Sent Items" }), false);
  assert.equal(isFilableFolder({ path: "Gesendete Elemente", name: "Gesendete Elemente" }), false);

  // The reason this is a normalised set rather than a substring match.
  assert.equal(isFilableFolder({ path: "Junk Removal Invoices", name: "Junk Removal Invoices" }), true);
  assert.equal(isFilableFolder({ path: "Business Receipts", name: "Business Receipts" }), true);
  assert.equal(isFilableFolder({ path: "Home Depot Receipts", name: "Home Depot Receipts" }), true);
  assert.equal(isFilableFolder({ path: "Tax", name: "Tax" }), true);
});

test("envelopes normalise the sender and survive a missing Message-ID", () => {
  const base = {
    uid: 42,
    bodyStructure: { type: "application/pdf", size: 100 },
    envelope: { messageId: "<abc@stadtwerke.de>", subject: "Ihre Rechnung", date: "2026-08-14T09:00:00Z", from: [{ address: "Rechnung@Stadtwerke.DE", name: "Stadtwerke" }] },
  };
  const withId = toEnvelope(base as never, "INBOX");
  assert.equal(withId.messageId, "<abc@stadtwerke.de>");
  assert.equal(withId.fromAddress, "rechnung@stadtwerke.de", "addresses are compared lowercased");
  assert.ok(withId.date instanceof Date, "a string date from the server is normalised");
  assert.equal(withId.parts[0]?.mimeType, "application/pdf");

  const noId = toEnvelope({ ...base, envelope: { ...base.envelope, messageId: undefined } } as never, "INBOX");
  const again = toEnvelope({ ...base, envelope: { ...base.envelope, messageId: undefined } } as never, "INBOX");
  assert.match(noId.messageId, /^<synthetic-/);
  assert.equal(noId.messageId, again.messageId, "the synthetic key is stable, so the message is not ingested twice");
});

test("connection-test failures are explained in terms someone can act on", () => {
  const gmail: MailSourceConfig = { host: "imap.gmail.com", port: 993, username: "anna@gmail.com", password: "x" };
  const auth = explain(new Error("Invalid credentials (Failure)"), gmail);
  assert.match(auth.problem, /rejected the username or password/);
  assert.match(auth.hint ?? "", /2-Step Verification/, "Gmail's actual prerequisite, not a generic message");

  const other: MailSourceConfig = { host: "mail.example.com", port: 993, username: "kai", password: "x" };
  assert.match(explain(new Error("AUTHENTICATIONFAILED"), other).hint ?? "", /app password/);
  assert.match(explain(new Error("did not negotiate TLS — refusing"), other).hint ?? "", /993|STARTTLS/);
  assert.match(explain(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }), other).problem, /could not be resolved/);
  assert.match(explain(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }), other).problem, /did not answer/);
  assert.match(explain(new Error("self-signed certificate in chain"), other).hint ?? "", /NODE_EXTRA_CA_CERTS/);
});

test("the connection test reports folders on success and always closes the connection", async () => {
  const service = new MailConnectionsService(null as never, null as never, null as never, null as never);
  const config: MailSourceConfig = { host: "imap.example.com", port: 993, username: "kai", password: "app-password" };
  let closed = 0;

  const stub = (over: Partial<MailSource>): MailSource => ({
    kind: "stub",
    connect: async () => undefined,
    close: async () => { closed += 1; },
    listFolders: async () => ["INBOX", "Rechnungen"],
    openFolder: async () => ({ uidValidity: 1, exists: 0 }),
    scan: () => (async function* () {})(),
    download: async () => Buffer.alloc(0),
    ...over,
  });

  const ok = await service.test(config, () => stub({}));
  assert.deepEqual(ok, { ok: true, folders: ["INBOX", "Rechnungen"], problem: null, hint: null });

  const failed = await service.test(config, () => stub({ connect: async () => { throw new Error("AUTHENTICATIONFAILED"); } }));
  assert.equal(failed.ok, false);
  assert.equal(failed.folders.length, 0);
  assert.match(failed.problem ?? "", /rejected/);
  assert.equal(closed, 2, "the connection is released whether the test passed or failed");
});
