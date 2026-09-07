import { titleFromFilename, type SuggestionPayload } from "@harbor/shared";
import type { SuggestInput, SuggestOutput, SuggestionProvider } from "./provider";

/**
 * Heuristics only — nothing leaves the box (spec §5 fallback). Guesses a category from keywords
 * in the filename/text, people from first names that appear in the text, and a date from the
 * filename. No summary; the Inbox shows its no-suggestion state.
 */
export class NoneProvider implements SuggestionProvider {
  readonly name = "none";

  async suggest(input: SuggestInput): Promise<SuggestOutput | null> {
    const haystack = `${input.filename}\n${input.text}`.toLowerCase();
    const categorySlug = guessCategory(haystack, input.categories.map((c) => c.slug));
    const itemLabels = input.items.filter((i) => new RegExp(`\\b${escape(i.label.toLowerCase())}\\b`).test(haystack)).map((i) => i.label);
    const documentDate = dateFromFilename(input.filename) ?? firstDateInText(input.text);
    const payload: SuggestionPayload = {
      summary: "",
      title: titleFromFilename(input.filename),
      categorySlug,
      newCategoryHint: null,
      itemLabels,
      documentDate,
      expiresAt: null,
      tags: [],
      aliases: [],
      // Heuristics cannot tell a leaflet from a bill, and the borderline rule is the same as the
      // model's: never hide something that might matter.
      keep: "paperwork",
      language: /\b(rechnung|versicherung|vertrag|bescheinigung)\b/.test(haystack) ? "de" : "en",
      confidence: categorySlug && itemLabels.length ? "medium" : "low",
    };
    return { payload, model: "heuristics", inputTokens: null, outputTokens: null };
  }
}

const KEYWORDS: [RegExp, string][] = [
  [/\b(impf|immuni[sz]|vaccin)/, "health/immunizations"],
  [/\b(rezept|prescription|medikament)/, "health/prescriptions"],
  [/\b(arzt|klinik|hospital|doctor|befund|diagnos)/, "health/records"],
  [/\b(strom|gas|wasser|electric|utility|stadtwerke|energie)/, "real-estate/utilities"],
  [/\b(mietvertrag|lease|miete)/, "real-estate/lease"],
  [/\b(grundbuch|deed|notar)/, "real-estate/deeds"],
  [/\b(hypothek|mortgage|darlehen)/, "real-estate/mortgage"],
  [/\b(kontoauszug|statement|iban|bank)/, "money/statements"],
  [/\b(steuer|tax|finanzamt|w-2|1099)/, "taxes/returns"],
  [/\b(kfz|auto|car|fahrzeug|vehicle)\b.*\b(versicherung|insurance|police|policy)/, "insurance/auto"],
  [/\b(hausrat|home)\b.*\b(versicherung|insurance)/, "insurance/home"],
  [/\b(kranken|health)\b.*\b(versicherung|insurance)/, "insurance/health"],
  [/\b(versicherung|insurance|police|policy)/, "insurance"],
  [/\b(reisepass|passport|personalausweis|ausweis)/, "identity/passports"],
  [/\b(geburtsurkunde|birth certificate)/, "identity/birth"],
  [/\b(führerschein|fuehrerschein|driver'?s? licen[cs]e|licen[cs]e)/, "identity/licenses"],
  [/\b(zeugnis|report card|transcript|schule|school)/, "education/report-cards"],
  [/\b(testament|will|trust|vollmacht|power of attorney)/, "legal-and-estate/wills-and-trusts"],
  [/\b(arbeitsvertrag|employment|gehalt|payslip|lohn)/, "work/pay-and-benefits"],
  [/\b(visa|visum|flug|flight|hotel|reise)/, "travel/trips"],
  [/\b(zulassung|registration|fahrzeugschein)/, "transportation/cars"],
];

export function guessCategory(haystack: string, available: string[]): string | null {
  for (const [re, slug] of KEYWORDS) {
    if (!re.test(haystack)) continue;
    if (available.includes(slug)) return slug;
    const top = slug.split("/")[0]!;
    if (available.includes(top)) return top;
  }
  return null;
}

export function dateFromFilename(name: string): string | null {
  const iso = /(20\d{2}|19\d{2})[-_.](0[1-9]|1[0-2])[-_.](0[1-9]|[12]\d|3[01])/.exec(name);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ym = /(20\d{2}|19\d{2})[-_.](0[1-9]|1[0-2])(?![\d])/.exec(name);
  if (ym) return `${ym[1]}-${ym[2]}-01`;
  return null;
}

export function firstDateInText(text: string): string | null {
  const de = /\b(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.(20\d{2}|19\d{2})\b/.exec(text);
  if (de) return `${de[3]}-${de[2]}-${de[1]}`;
  const iso = /\b(20\d{2}|19\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/.exec(text);
  if (iso) return iso[0];
  return null;
}



function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
