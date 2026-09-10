import { z } from "zod/v4";
import { Category, ItemKind } from "./vocabulary";

const HomeItem = z.object({
  id: z.string().uuid(),
  kind: ItemKind,
  label: z.string(),
  subtitle: z.string().nullable(),
  documentCount: z.number().int().nonnegative(),
  /** Null when the item has no photo; Home then draws the initial or the glyph instead. */
  avatarUpdatedAt: z.string().datetime().nullable(),
  /** The soonest future expiry among this item's documents, if any. */
  next: z.object({ documentId: z.string().uuid(), title: z.string(), expiresAt: z.string().date(), daysLeft: z.number().int() }).nullable(),
});

/** Everything the Home artboard shows, in one round trip. */
export const HomeData = z.object({
  /** kind = person: the Family row. */
  family: z.array(HomeItem),
  /** Everything else: the Property & things row. */
  things: z.array(HomeItem),
  categories: z.array(Category),
  totalDocuments: z.number().int().nonnegative(),
  /** Spec §4: Home carries the backup state, because a vault nobody backs up should say so. */
  backup: z.object({ state: z.enum(["ok", "failed", "never", "unconfigured"]), at: z.string().datetime().nullable() }),
  /**
   * One panel for both lifecycles (spec §8). A bill to pay and a passport running out both want
   * looking at, but only one of them can be ticked off — a passport is resolved by filing a new
   * one. `kind` is what tells the panel which of the two it is holding, and it is the reason the
   * old "Expiring soon" list could not simply be extended.
   */
  needsAttention: z.array(
    z.object({
      kind: z.enum(["task", "expiry"]),
      /** Task id for a task, document id for an expiry. */
      id: z.string().uuid(),
      title: z.string(),
      documentId: z.string().uuid().nullable(),
      subtitle: z.string().nullable(),
      dueOn: z.string().date().nullable(),
      daysLeft: z.number().int().nullable(),
      amountCents: z.number().int().nullable(),
      currency: z.string().nullable(),
    }),
  ),
  recentlyAdded: z.array(
    z.object({
      documentId: z.string().uuid(),
      title: z.string(),
      source: z.enum(["upload", "email"]),
      categoryPath: z.string().nullable(),
      createdAt: z.string().datetime(),
      needsFiling: z.boolean(),
    }),
  ),
});
export type HomeData = z.infer<typeof HomeData>;
