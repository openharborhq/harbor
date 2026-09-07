import type { Item } from "@harbor/shared";

/**
 * A category slug and item labels, turned into the ids a document is filed under.
 *
 * The same rule serves two callers that must not drift apart: a suggestion the reader accepts,
 * and a sender rule that files their mail without anyone reading it (§6, §7.6). Unknown values
 * are dropped rather than raised — vocabulary changes over time, and a category the owner has
 * since renamed should cost the document its filing, not its ingest.
 */
export interface VocabularyChoice {
  categorySlug?: string | null;
  itemLabels?: string[] | null;
}

export interface ResolvedVocabulary {
  categoryId: string | null;
  categoryPath: string | null;
  itemIds: string[];
}

export function resolveVocabulary(
  categories: Map<string, { cat: { id: string; slug: string }; path: string }>,
  items: Item[],
  choice: VocabularyChoice,
): ResolvedVocabulary {
  const bySlug = new Map([...categories.values()].map((c) => [c.cat.slug, c]));
  const cat = choice.categorySlug ? bySlug.get(choice.categorySlug) : undefined;

  const wanted = new Set((choice.itemLabels ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean));
  const matched = wanted.size ? items.filter((i) => wanted.has(i.label.toLowerCase()) || wanted.has(firstName(i.label).toLowerCase())) : [];
  // Naming a child implies its parent: a boiler invoice is also about the house (spec §6).
  const itemIds = [...new Set(matched.flatMap((i) => (i.parentId ? [i.id, i.parentId] : [i.id])))];

  return { categoryId: cat?.cat.id ?? null, categoryPath: cat?.path ?? null, itemIds };
}

/** "Anna Muster" and "Anna" name the same person to a model that only saw the first name. */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}
