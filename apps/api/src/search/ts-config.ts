/**
 * Text-search configs, in their own file so nothing has to import the service to get them.
 * SearchService imports CategoriesService, which imports SearchIndexService — putting these in
 * search.service.ts closed that loop and left Nest unable to resolve CategoriesService at all.
 *
 * Every document is indexed under all three at once, and every query runs against all three.
 * `simple` never stems, which is what invoice numbers, IBANs and names need; `german` and
 * `english` add stems, which is what "bills" and "Rechnungen" need.
 */
export const TS_CONFIGS = ["simple", "german", "english"] as const;

/** The config for `ts_headline`: it highlights against the raw text, so it must not stem. */
export const TS_CONFIG = "simple";
