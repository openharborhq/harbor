/**
 * "Is this the same paper I already have?" (spec §8 to-do; measured 2026-09-10).
 *
 * `sha256` answers it for identical bytes and nothing else, so two passes through a scanner make
 * two documents. The obvious next move — compare the extracted text — does not work, and the vault
 * says so plainly:
 *
 * | pair                                          | text similarity | number overlap |
 * | --------------------------------------------- | --------------- | -------------- |
 * | true duplicates, byte-different                | 1.000           | 1.000          |
 * | the same tax bill scanned twice                | 0.894           | 0.935          |
 * | two *different* leasing offers from one dealer | 0.90 – 0.98     | 0.56 – 0.84    |
 *
 * The re-scan scores *lower* on prose than eleven pairs of genuinely distinct documents, because a
 * sender's letterhead, address block and terms dominate their text. What separates them is the
 * numbers: two scans of one page carry the same amounts, dates and invoice numbers; two offers for
 * different cars do not.
 *
 * So prose is the sanity check and the numbers are the evidence.
 */

/** Below this the numbers are not saying the same thing. Highest genuine-different pair measured: 0.840. */
export const NUMBER_OVERLAP = 0.9;
/** A weak floor. Its job is to reject a coincidence of numbers in unrelated text, nothing more. */
export const TEXT_SIMILARITY = 0.7;
/** Fewer numbers than this and an overlap means very little — a two-line note, a photo of a sign. */
const MIN_NUMBERS = 6;

export interface Likeness {
  numberOverlap: number;
  textSimilarity: number;
  isCopy: boolean;
}

/** Lowercased, stripped to letters and digits — the form both measures are taken on. */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Every distinct number in the document: amounts, dates, invoice and account numbers, meter
 * readings. Three characters minimum, so page numbers and years alone do not carry a match.
 */
export function numberTokens(text: string): Set<string> {
  const found = text.match(/[0-9][0-9.,]{2,}/g) ?? [];
  const tokens = new Set<string>();
  for (const raw of found) {
    const token = raw.replace(/[.,]+$/, "");
    if (token.length >= 3) tokens.add(token);
  }
  return tokens;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function trigrams(normalised: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= normalised.length; i += 1) out.add(normalised.slice(i, i + 3));
  return out;
}

/** Trigram overlap, the same shape as Postgres's `similarity()` — used here so it stays testable. */
export function textSimilarity(a: string, b: string): number {
  return jaccard(trigrams(normalise(a)), trigrams(normalise(b)));
}

/**
 * Whether two documents look like the same piece of paper.
 *
 * It proposes and never decides: the answer reaches a person as "looks like a copy of X", with
 * keeping both as the option that needs no action at all.
 */
export function likeness(a: string, b: string): Likeness {
  const numbersA = numberTokens(a);
  const numbersB = numberTokens(b);
  const numberOverlap = jaccard(numbersA, numbersB);
  const similarity = textSimilarity(a, b);
  const enoughNumbers = numbersA.size >= MIN_NUMBERS && numbersB.size >= MIN_NUMBERS;
  return {
    numberOverlap,
    textSimilarity: similarity,
    isCopy: enoughNumbers && numberOverlap >= NUMBER_OVERLAP && similarity >= TEXT_SIMILARITY,
  };
}

/** How close in size two files have to be before they are worth comparing at all. */
export const SIZE_TOLERANCE = 0.05;

export function sizeIsClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(a, b) * SIZE_TOLERANCE;
}
