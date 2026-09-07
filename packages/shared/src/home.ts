import { z } from "zod/v4";
import { Category, ItemKind } from "./vocabulary";

const HomeItem = z.object({
  id: z.string().uuid(),
  kind: ItemKind,
  label: z.string(),
  subtitle: z.string().nullable(),
  documentCount: z.number().int().nonnegative(),
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
  expiringSoon: z.array(
    z.object({
      documentId: z.string().uuid(),
      title: z.string(),
      categoryPath: z.string().nullable(),
      items: z.array(z.string()),
      expiresAt: z.string().date(),
      daysLeft: z.number().int(),
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
