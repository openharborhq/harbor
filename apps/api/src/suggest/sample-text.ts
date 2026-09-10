/**
 * How much of a document the model actually gets to read (spec §5).
 *
 * `pdftotext` and `ocrmypdf` both separate pages with a form feed, so page boundaries survive into
 * `document_text`. That matters: the old rule — take the first N characters — did not just truncate
 * long documents, it silently confined the model to page one. At roughly 7,000 characters per
 * scanned page, a 4,000-character window never reached page two of anything, and 44% of this vault
 * is longer than that window.
 *
 * So the budget is spread across the pages rather than spent on the first. Every page contributes
 * its opening lines, which is where a page says what it is; the last page also contributes its
 * ending, which is where totals, due dates and payment details sit.
 */
export const PAGE_BREAK = "\f";

/** Roughly 6k tokens of text. Generous next to what a suggestion costs, and bounded for the 500k outlier. */
export const TEXT_BUDGET = 24_000;

/** Below this a page is not worth splitting head from tail; just take the head. */
const MIN_SPLIT = 600;

export interface SampledText {
  text: string;
  /** True when anything was left out, so the prompt can say so rather than implying completeness. */
  truncated: boolean;
  pages: number;
}

export function sampleText(raw: string, budget = TEXT_BUDGET): SampledText {
  const text = raw.trim();
  const pages = text.split(PAGE_BREAK).map((p) => p.trim()).filter((p) => p.length > 0);
  if (pages.length === 0) return { text: "", truncated: false, pages: 0 };
  if (text.length <= budget) return { text, truncated: false, pages: pages.length };
  if (pages.length === 1) return { text: headAndTail(pages[0]!, budget), truncated: true, pages: 1 };

  const shares = allocate(pages.map((p) => p.length), budget);
  let truncated = false;
  const parts = pages.map((page, i) => {
    const share = shares[i]!;
    if (page.length <= share) return `[page ${i + 1}]\n${page}`;
    truncated = true;
    // The last page earns a look at its ending — that is where the total and the IBAN live.
    const body = i === pages.length - 1 ? headAndTail(page, share) : page.slice(0, share).trimEnd() + "\n[…]";
    return `[page ${i + 1} of ${pages.length}, shortened]\n${body}`;
  });
  return { text: parts.join("\n\n"), truncated, pages: pages.length };
}

/**
 * Even shares, with what a short page cannot use handed back to the pages that can.
 *
 * Without the hand-back a covering letter of two lines would hold a full share hostage while the
 * invoice behind it got cut, which is the wrong way round.
 */
function allocate(lengths: number[], budget: number): number[] {
  const shares = new Array<number>(lengths.length).fill(0);
  let remaining = budget;
  let claimants = lengths.map((_, i) => i);
  while (claimants.length > 0 && remaining > 0) {
    const each = Math.floor(remaining / claimants.length);
    if (each === 0) break;
    const next: number[] = [];
    let spent = 0;
    for (const i of claimants) {
      const want = lengths[i]! - shares[i]!;
      const give = Math.min(want, each);
      shares[i] += give;
      spent += give;
      if (give === each && want > give) next.push(i);
    }
    remaining -= spent;
    if (next.length === claimants.length && spent === 0) break;
    claimants = next;
  }
  return shares;
}

/** Two thirds from the front, one third from the back, with the cut marked. */
function headAndTail(page: string, budget: number): string {
  if (page.length <= budget) return page;
  if (budget < MIN_SPLIT) return page.slice(0, budget).trimEnd() + "\n[…]";
  const head = Math.floor((budget * 2) / 3);
  const tail = budget - head;
  return `${page.slice(0, head).trimEnd()}\n[…]\n${page.slice(-tail).trimStart()}`;
}
