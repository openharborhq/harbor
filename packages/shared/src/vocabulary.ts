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

export const RenameCategory = z.object({ name: z.string().trim().min(1).max(60) });
export type RenameCategory = z.infer<typeof RenameCategory>;

/** Siblings in the order they should appear. Reordering across different parents is refused. */
export const ReorderCategories = z.object({ ids: z.array(z.string().uuid()).min(1).max(60) });
export type ReorderCategories = z.infer<typeof ReorderCategories>;

// ---- Items: the things documents are about (spec §6) ----

/**
 * Kinds are data, not code: adding one is a row plus a label, never a migration.
 * `person` is simply the first kind — the family members documents are about.
 */
export const ItemKind = z.enum(["person", "property", "vehicle", "account", "policy", "pet", "business", "other"]);
export type ItemKind = z.infer<typeof ItemKind>;

/** Kinds offered in the "add" menus today; the rest are valid but not surfaced yet. */
export const ACTIVE_ITEM_KINDS = ["person", "property", "vehicle", "account"] as const;

export const ITEM_KIND_LABEL: Record<ItemKind, { one: string; many: string }> = {
  person: { one: "Person", many: "People" },
  property: { one: "Property", many: "Property" },
  vehicle: { one: "Vehicle", many: "Vehicles" },
  account: { one: "Account", many: "Accounts" },
  policy: { one: "Policy", many: "Policies" },
  pet: { one: "Pet", many: "Pets" },
  business: { one: "Business", many: "Businesses" },
  other: { one: "Other", many: "Other" },
};

export const Item = z.object({
  id: z.string().uuid(),
  kind: ItemKind,
  label: z.string(),
  /** Kind-specific: dateOfBirth/relationship, address, plate, institution… */
  details: z.record(z.string(), z.unknown()),
  parentId: z.string().uuid().nullable(),
  parentLabel: z.string().nullable(),
  notes: z.string().nullable(),
  sortOrder: z.number().int(),
  documentCount: z.number().int().nonnegative(),
});
export type Item = z.infer<typeof Item>;

export const CreateItem = z.object({
  kind: ItemKind,
  label: z.string().trim().min(1).max(120),
  details: z.record(z.string(), z.unknown()).optional(),
  parentId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreateItem = z.infer<typeof CreateItem>;

export const UpdateItem = CreateItem.partial();
export type UpdateItem = z.infer<typeof UpdateItem>;

/** What deleting an item cost: documents keep existing, they are only unlinked (spec §6). */
export const DeleteItemResult = z.object({
  documentsUnlinked: z.number().int().nonnegative(),
  childrenDetached: z.number().int().nonnegative(),
});
export type DeleteItemResult = z.infer<typeof DeleteItemResult>;

export const KeyDocumentSlot = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  sortOrder: z.number().int(),
  document: z
    .object({ id: z.string().uuid(), title: z.string(), expiresAt: z.string().date().nullable(), documentDate: z.string().date().nullable() })
    .nullable(),
});
export type KeyDocumentSlot = z.infer<typeof KeyDocumentSlot>;

export const UpsertKeyDocument = z.object({
  kind: z.string().trim().min(1).max(60),
  documentId: z.string().uuid().nullable().optional(),
});
export type UpsertKeyDocument = z.infer<typeof UpsertKeyDocument>;

/** The slots a new item starts with, so absence is visible from day one. */
export const DEFAULT_KEY_DOCUMENTS: Record<ItemKind, string[]> = {
  person: ["Passport", "Birth Certificate", "Health Insurance Card", "Immunization Record", "Social Security Card"],
  property: ["Deed", "Mortgage", "Building Insurance", "Energy Certificate", "Floor Plan"],
  vehicle: ["Title", "Registration", "Insurance Policy", "Service History"],
  account: ["Account Opening", "Latest Statement", "Beneficiaries"],
  policy: ["Policy Document", "Latest Renewal"],
  pet: ["Vaccination Record", "Microchip", "Pet Insurance"],
  business: ["Registration", "Tax Filing", "Insurance"],
  other: [],
};

/** The kind-specific fields the add/edit forms offer. `details` stays free-form; this is only the UI's opinion. */
export const ITEM_DETAIL_FIELDS: Record<ItemKind, { key: string; label: string; type: "text" | "date"; placeholder?: string }[]> = {
  person: [
    { key: "relationship", label: "Relationship", type: "text", placeholder: "Daughter, Father, …" },
    { key: "dateOfBirth", label: "Date of birth", type: "date" },
  ],
  property: [
    { key: "address", label: "Address", type: "text", placeholder: "Musterstraße 7, München" },
    { key: "acquiredOn", label: "Bought on", type: "date" },
  ],
  vehicle: [
    { key: "plate", label: "Plate", type: "text", placeholder: "M-AB 1234" },
    { key: "year", label: "Year", type: "text", placeholder: "2019" },
  ],
  account: [
    { key: "institution", label: "Institution", type: "text", placeholder: "Sparkasse, Vanguard, …" },
    { key: "last4", label: "Last 4", type: "text", placeholder: "4821" },
  ],
  policy: [{ key: "insurer", label: "Insurer", type: "text" }],
  pet: [{ key: "species", label: "Species", type: "text", placeholder: "Dog" }],
  business: [{ key: "role", label: "Role", type: "text", placeholder: "Owner" }],
  other: [],
};

/** Kinds that can sit inside another item — a boiler inside a house (spec §6). */
export const NESTABLE_ITEM_KINDS = ["property", "vehicle", "account", "policy", "other"] as const;

/** A one-line description of an item built from its kind-specific details. */
export function itemSubtitle(item: { kind: ItemKind; details: Record<string, unknown> }): string | null {
  const d = item.details;
  const str = (k: string) => (typeof d[k] === "string" && d[k] ? (d[k] as string) : null);
  switch (item.kind) {
    case "person":
      return str("relationship");
    case "property":
      return str("address");
    case "vehicle":
      return [str("plate"), str("year")].filter(Boolean).join(" · ") || null;
    case "account":
      return [str("institution"), str("last4") ? `••${str("last4")}` : null].filter(Boolean).join(" · ") || null;
    default:
      return null;
  }
}

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
