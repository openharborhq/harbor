import { z } from "zod/v4";

/**
 * Exactly what the model is asked to return (spec §5). Used both as the structured-output
 * schema sent to the API and to validate what comes back, so the two can never drift.
 * Constrained to the vault's own vocabulary: category slugs and people names must come from
 * the lists in the prompt; anything else is dropped when the suggestion is resolved.
 */
export const SuggestionPayload = z.object({
  /** ≤ 2 sentences, plain language, in the reader's language. Opens like "Looks like …". */
  summary: z.string().max(600),
  /** Human title, ≤ 60 chars, no filename noise. */
  title: z.string().max(80),
  /** One of the offered category slugs, or null when none fits. */
  categorySlug: z.string().nullable(),
  /** Free text if a category is missing from the vault; never auto-created. */
  newCategoryHint: z.string().max(60).nullable(),
  /** Subset of the offered item labels — people and things alike (spec §6). */
  itemLabels: z.array(z.string()).max(6),
  /** ISO date the document is dated, or null. */
  documentDate: z.string().nullable(),
  /** ISO date only when the document itself states an expiry/renewal, else null. */
  expiresAt: z.string().nullable(),
  /** From the offered tags only, ≤ 3. */
  tags: z.array(z.string()).max(3),
  /**
   * Other names a reader might search this document by, in the document's language *and* the
   * reader's — "birth certificate" for an Abstammungsurkunde (spec §5). Indexed, never displayed.
   */
  aliases: z.array(z.string().max(60)).max(8),
  /**
   * Whether this is a document a household files at all (§5).
   *
   * The other fields answer "where does this go?", and that question always has an answer — a
   * propane safety leaflet and a slide deck get categorised as confidently as an invoice, which
   * is how an Inbox fills with things nobody would ever look for. This asks the question that
   * was missing, from the document's own text rather than its filename.
   *
   * Advisory only. Nothing is deleted on the model's say-so; it decides which pile a card
   * starts in, and that is all.
   *
   * Defaulted, not required, because this schema validates rows already in the database as well
   * as output coming back from the model. Adding a required field made every suggestion written
   * before it existed fail `safeParse`, and the read path drops what it cannot parse — so 273
   * perfectly good summaries vanished from the UI at once. Any field added here later must carry
   * a default for the same reason.
   */
  keep: z.enum(["paperwork", "not_paperwork"]).default("paperwork"),
  /**
   * What this document says still has to be *done* — a bill to pay, a form to return, a deadline
   * to meet (spec §8). Proposals only: nothing is created until a person accepts the suggestion,
   * exactly like the category and the items.
   *
   * This is where a payment due date belongs. It used to be crammed into `expiresAt`, which is
   * why Home's "Expiring soon" panel was 98% lapsed bills and one passport.
   *
   * Defaulted for the reason spelled out on `keep`: this schema also validates rows written
   * before the field existed, and the read path drops what it cannot parse.
   */
  obligations: z
    .array(
      z.object({
        kind: z.enum(["pay", "file", "renew", "fetch", "review"]),
        title: z.string().max(80),
        dueOn: z.string().nullable(),
        /** Minor units — 24810 for €248.10. Null unless the document states an amount. */
        amountCents: z.number().int().nullable(),
        currency: z.string().max(3).nullable(),
      }),
    )
    .max(3)
    .default([]),
  /** Language the document is written in, ISO 639-1. */
  language: z.string().max(8),
  confidence: z.enum(["high", "medium", "low"]),
});
export type SuggestionPayload = z.infer<typeof SuggestionPayload>;

/** A stored suggestion, plus the payload resolved against the current vocabulary. */
export const SuggestionView = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  model: z.string(),
  payload: SuggestionPayload,
  /** categorySlug → id and itemLabels → ids, resolved server-side; unknown values dropped. */
  resolved: z.object({
    categoryId: z.string().uuid().nullable(),
    categoryPath: z.string().nullable(),
    itemIds: z.array(z.string().uuid()),
  }),
  createdAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  rejectedAt: z.string().datetime().nullable(),
});
export type SuggestionView = z.infer<typeof SuggestionView>;
