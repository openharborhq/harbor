import { z } from "zod/v4";
import { Category } from "./vocabulary";

/** Everything the Home artboard shows, in one round trip. */
export const HomeData = z.object({
  family: z.array(
    z.object({
      id: z.string().uuid(),
      displayName: z.string(),
      relationship: z.string().nullable(),
      documentCount: z.number().int().nonnegative(),
      /** The soonest future expiry among this person's documents, if any. */
      next: z.object({ documentId: z.string().uuid(), title: z.string(), expiresAt: z.string().date(), daysLeft: z.number().int() }).nullable(),
    }),
  ),
  categories: z.array(Category),
  totalDocuments: z.number().int().nonnegative(),
  expiringSoon: z.array(
    z.object({
      documentId: z.string().uuid(),
      title: z.string(),
      categoryPath: z.string().nullable(),
      people: z.array(z.string()),
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
