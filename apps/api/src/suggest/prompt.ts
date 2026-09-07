import type { SuggestInput } from "./provider";

/**
 * The prompt every model-backed provider sends (spec §5). Kept out of the providers so Claude and
 * an OpenAI-compatible endpoint are asked exactly the same thing and their output stays comparable
 * — `suggestions` rows from two backends differ by provider, not by wording.
 *
 * Order matters: the stable system text and the vault vocabulary come first (Anthropic marks the
 * boundary with cache_control; OpenAI caches long prefixes on its own), the per-document block last.
 */
export const SYSTEM_PROMPT = `You file paperwork for one family's private document vault. For each document you receive extracted text (often OCR of a scan, so expect small errors) and you return a filing suggestion.

Rules:
- summary: at most two sentences, plain language, written in the reader's language given below, and starting with "Looks like". Name the sender/issuer, what the document is, the key amount or number, and the important date. Never guess; if the text does not say, leave it out.
- title: a short human title, at most 60 characters, no file names, no dates unless they are the point.
- categorySlug: choose exactly one slug from the CATEGORIES list, or null if none fits. Never invent a slug. If a category is genuinely missing, put a short name in newCategoryHint and still pick the closest existing slug or null.
- itemLabels: only labels from the ITEMS list that the document is *about* — the patient, the account holder, the pupil, the house the bill is for, the car being serviced. Not things merely mentioned. If an item has a parent (a boiler in a house), naming the child is enough; the parent is added for you. Empty list if unsure.
- documentDate: the date the document is dated (issue date), ISO YYYY-MM-DD, or null.
- expiresAt: only when the document itself states an expiry, renewal or due date that matters to keeping it (passport expiry, policy end, registration renewal). Payment due dates on bills count. Otherwise null.
- tags: up to three from the TAGS list only; empty if none apply.
- aliases: up to six other names a member of this household might type into search looking for this document, in BOTH the document's language and the reader's language. Include the everyday name for this kind of document, not only its formal one — an Abstammungsurkunde is also "birth certificate", "Geburtsurkunde" and "certificate of descent"; a KFZ-Versicherung is also "car insurance" and "auto policy". Name the document type, never its contents, and never repeat the title verbatim. Empty list if the document type is already obvious from the title in both languages.
- keep: "paperwork" if this is something a household would deliberately keep — a bill, invoice, receipt, statement, policy, contract, certificate, tax document, medical record, registration, warranty, anything proving a payment, an obligation or an identity. "not_paperwork" for everything else that merely arrived as an attachment: marketing leaflets, safety notices, newsletters, event flyers, slide decks, screenshots, generic terms-and-conditions, articles. Judge the document itself, not who sent it — a utility company also sends leaflets. When it is genuinely borderline, say "paperwork": a wrongly hidden bill costs more than a leaflet in the list.
- language: ISO 639-1 code of the document's language.
- confidence: high only when category, people and dates are all clear from the text; medium when the category is clear but something is missing; low otherwise.`;

export function vocabularyBlock(input: SuggestInput): string {
  const cats = input.categories.map((c) => `- ${c.slug} — ${c.path}`).join("\n");
  const itemLines = input.items.length
    ? input.items.map((i) => `- ${i.label} (${i.kind}${i.parentLabel ? `, part of ${i.parentLabel}` : ""})`).join("\n")
    : "(not provided — leave itemLabels empty)";
  const tags = input.tags.length ? input.tags.join(", ") : "(none)";
  return `CATEGORIES (slug — name):\n${cats}\n\nITEMS — the people and things this family keeps paperwork for:\n${itemLines}\n\nTAGS: ${tags}\n\nReader's language: ${input.readerLanguage}`;
}

export function documentBlock(input: SuggestInput): string {
  const meta = [
    `Filename: ${input.filename}`,
    `Arrived by: ${input.source}${input.senderAddress ? ` from ${input.senderAddress}` : ""}`,
    input.pageCount !== null ? `Pages: ${input.pageCount}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${meta}\n\nEXTRACTED TEXT (first ${input.text.length} characters):\n"""\n${input.text}\n"""`;
}
