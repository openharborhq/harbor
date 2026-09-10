import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jaccard, likeness, numberTokens, sizeIsClose, textSimilarity } from "./duplicates";

/**
 * Invented paperwork, shaped like the real thing that prompted this (spec §8 to-do): a sender's
 * boilerplate dominates the prose, and the numbers are what actually distinguish one document
 * from the next.
 */
const BOILERPLATE = `
Autohaus Nordstern GmbH · Ringstrasse 40 · 80331 Munchen
Telefon 089 555 0100 · Fax 089 555 0199 · info@nordstern-auto.example
USt-IdNr DE811234567 · Amtsgericht Munchen HRB 998877 · Steuernummer 143/822/60155
Geschaftsfuhrer Anna Berger · Handelsregister eingetragen 12.04.1998
Bankverbindung IBAN DE44 5001 0517 5407 3249 31 · BIC PBNKDEFF · Konto 5407324931
Unsere Angebote sind freibleibend und gelten vorbehaltlich Zwischenverkauf.
Es gelten unsere Allgemeinen Geschaftsbedingungen in der jeweils gultigen Fassung.
Zahlbar innerhalb von 14 Tagen ohne Abzug · Verzugszinsen 9.00 Prozent uber Basiszins.
Widerrufsbelehrung nach Paragraph 355 BGB · Frist 14 Tage ab Vertragsschluss.
`.repeat(3);

const OFFER_A = `${BOILERPLATE}
Angebot 2026-4471 vom 02.09.2026
Fahrzeug XC60 T8 · Erstzulassung 03.2024 · Laufleistung 18450 km
Listenpreis 61990.00 EUR · Anzahlung 9500.00 EUR · Rate 649.90 EUR
Laufzeit 36 Monate · Gesamtbetrag 32846.40 EUR · Effektivzins 3.99
`;

/**
 * The hardest genuine pair there is: the same dealer quoting the same car again on different
 * terms. Everything matches except four figures — and it is still a different document, because
 * agreeing to one of these is not agreeing to the other.
 */
const OFFER_B = `${BOILERPLATE}
Angebot 2026-4482 vom 04.09.2026
Fahrzeug XC60 T8 · Erstzulassung 03.2024 · Laufleistung 18450 km
Listenpreis 61990.00 EUR · Anzahlung 9500.00 EUR · Rate 548.15 EUR
Laufzeit 48 Monate · Gesamtbetrag 35827.60 EUR · Effektivzins 3.99
`;

/** The same sheet of paper through the scanner a second time: the numbers hold, the prose slips. */
const OFFER_A_RESCANNED = OFFER_A.replace("Geschaftsfuhrer", "Geschbftsfuhrer")
  .replace("freibleibend", "freibleiberid")
  .replace("Zwischenverkauf", "Zwischenverkaut")
  .replace("Allgemeinen", "AIIgemeinen")
  .replace("Erstzulassung", "Erstzulassunq");

describe("number tokens", () => {
  it("keeps what identifies a document and drops what does not", () => {
    const tokens = numberTokens("Invoice 4471 dated 02.09.2026 for 248,10 EUR, page 2 of 3");
    assert.ok(tokens.has("4471"));
    assert.ok(tokens.has("02.09.2026"));
    assert.ok(tokens.has("248,10"));
    // Single digits are page furniture, not identity.
    assert.equal(tokens.has("2"), false);
    assert.equal(tokens.has("3"), false);
  });

  it("does not let trailing punctuation split a token in two", () => {
    assert.deepEqual([...numberTokens("total 1.234,50.")], ["1.234,50"]);
  });
});

describe("telling a re-scan from a look-alike", () => {
  it("catches the same paper scanned twice", () => {
    const result = likeness(OFFER_A, OFFER_A_RESCANNED);
    assert.equal(result.isCopy, true, `numbers ${result.numberOverlap}, text ${result.textSimilarity}`);
    assert.ok(result.numberOverlap >= 0.9);
  });

  it("leaves two different offers from the same dealer alone", () => {
    // The trap this whole approach exists for: the prose is nearly identical and the documents
    // are not. Measured on the real vault at text 0.90-0.98 with number overlap 0.56-0.84.
    const result = likeness(OFFER_A, OFFER_B);
    assert.equal(result.isCopy, false);
    assert.ok(result.textSimilarity > 0.8, `the prose really is this alike — that is the point (${result.textSimilarity})`);
    // Deliberately close to the line: the vault's hardest genuine pair sat at 0.840.
    assert.ok(result.numberOverlap > 0.6, `too easy a case to be worth testing (${result.numberOverlap})`);
    assert.ok(result.numberOverlap < 0.9, `numbers overlapped ${result.numberOverlap}`);
  });

  it("ignores a document with too few numbers to be identified by them", () => {
    const note = "Reminder: ask the Hausverwaltung about the meter reading before 01.10";
    assert.equal(likeness(note, note).isCopy, false);
  });

  it("is not fooled by unrelated text that happens to share figures", () => {
    const numbers = "4471 02.09.2026 248,10 61990.00 9500.00 649.90";
    const a = `Stadtwerke invoice ${numbers}`;
    const b = `Kita registration form for the autumn term ${numbers}`;
    const result = likeness(a, b);
    assert.ok(result.numberOverlap >= 0.9, "the numbers do match");
    assert.equal(result.isCopy, false, "but the documents do not, and the prose floor says so");
  });
});

describe("the cheap gates", () => {
  it("compares only files of about the same size", () => {
    assert.equal(sizeIsClose(4_676_744, 4_668_254), true); // the real re-scan pair
    assert.equal(sizeIsClose(4_676_744, 12_043_885), false);
  });

  it("scores an empty comparison at zero rather than dividing by nothing", () => {
    assert.equal(jaccard(new Set(), new Set()), 0);
    assert.equal(textSimilarity("", ""), 0);
  });
});
