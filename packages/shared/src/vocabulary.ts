import { z } from "zod/v4";

export const Category = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  parentId: z.string().uuid().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  /** Documents filed directly in this category (not including children). */
  documentCount: z.number().int().nonnegative(),
});
export type Category = z.infer<typeof Category>;

export const CreateCategory = z.object({
  name: z.string().trim().min(1).max(60),
  parentId: z.string().uuid().nullable().optional(),
  icon: z.string().max(32).nullable().optional(),
});
export type CreateCategory = z.infer<typeof CreateCategory>;

export const Person = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  dateOfBirth: z.string().date().nullable(),
  relationship: z.string().nullable(),
  notes: z.string().nullable(),
  documentCount: z.number().int().nonnegative(),
});
export type Person = z.infer<typeof Person>;

export const CreatePerson = z.object({
  displayName: z.string().trim().min(1).max(80),
  dateOfBirth: z.string().date().nullable().optional(),
  relationship: z.string().trim().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreatePerson = z.infer<typeof CreatePerson>;

/** "Real Estate › Utilities" */
export function categoryPath(cat: { name: string }, parent: { name: string } | null | undefined): string {
  return parent ? `${parent.name} › ${cat.name}` : cat.name;
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
