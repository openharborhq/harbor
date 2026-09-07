import { pgTable, uuid, text, integer, timestamp, index, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";

/** Two levels deep (spec §1). Depth is enforced in the service, not the database. */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("categories_parent_idx").on(t.parentId)],
);

/**
 * The things documents are *about* — the second axis, orthogonal to categories (spec §6).
 *
 * A house's paperwork spans Real Estate, Money, Insurance, Taxes and Purchases, so the house
 * cannot be a category without deforming the taxonomy; it is a subject the documents point at.
 * People were the first instance of this idea and are now one `kind` among several.
 *
 * `kind` is deliberately free text with a known set rather than a database enum: adding "pet"
 * or "business" is then a row and a label, not a migration.
 */
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** person | property | vehicle | account | policy | pet | business | other */
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    /** Kind-specific fields: dateOfBirth/relationship, address, plate/vin, institution/last4… */
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    /** The boiler belongs to the house; the house owns its utility account. */
    parentId: uuid("parent_id").references((): AnyPgColumn => items.id, { onDelete: "set null" }),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("items_kind_idx").on(t.kind, t.sortOrder), index("items_parent_idx").on(t.parentId)],
);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
