import { test } from "node:test";
import assert from "node:assert/strict";
import type { Item } from "@harbor/shared";
import { firstName, resolveVocabulary } from "./resolve";

const cats = new Map([
  ["c1", { cat: { id: "c1", slug: "utilities" }, path: "Home / Utilities" }],
  ["c2", { cat: { id: "c2", slug: "insurance" }, path: "Insurance" }],
]);

const item = (over: Partial<Item> & { id: string; label: string }): Item => ({
  kind: "person",
  details: {},
  parentId: null,
  parentLabel: null,
  notes: null,
  sortOrder: 0,
  documentCount: 0,
  ...over,
});
const items: Item[] = [
  item({ id: "p1", label: "Anna Muster" }),
  item({ id: "h1", label: "Musterstraße 7", kind: "property" }),
  item({ id: "b1", label: "Boiler", kind: "other", parentId: "h1", parentLabel: "Musterstraße 7" }),
];

test("a slug becomes its category, and an unknown slug files nothing", () => {
  assert.equal(resolveVocabulary(cats, items, { categorySlug: "utilities" }).categoryId, "c1");
  assert.equal(resolveVocabulary(cats, items, { categorySlug: "utilities" }).categoryPath, "Home / Utilities");
  // A category the owner renamed away must cost the filing, never the ingest.
  assert.equal(resolveVocabulary(cats, items, { categorySlug: "gone" }).categoryId, null);
  assert.equal(resolveVocabulary(cats, items, {}).categoryId, null);
});

test("labels match case-insensitively and by first name", () => {
  assert.deepEqual(resolveVocabulary(cats, items, { itemLabels: ["anna muster"] }).itemIds, ["p1"]);
  assert.deepEqual(resolveVocabulary(cats, items, { itemLabels: ["Anna"] }).itemIds, ["p1"]);
  assert.deepEqual(resolveVocabulary(cats, items, { itemLabels: ["  Anna  "] }).itemIds, ["p1"]);
  assert.deepEqual(resolveVocabulary(cats, items, { itemLabels: ["nobody"] }).itemIds, []);
  assert.deepEqual(resolveVocabulary(cats, items, { itemLabels: [] }).itemIds, []);
});

test("naming a child names its parent too, without duplicating it", () => {
  // Which ids, not in which order — the order is the vocabulary's, and nothing depends on it.
  const ids = (labels: string[]) => [...resolveVocabulary(cats, items, { itemLabels: labels }).itemIds].sort();
  assert.deepEqual(ids(["Boiler"]), ["b1", "h1"]);
  assert.deepEqual(ids(["Boiler", "Musterstraße 7"]), ["b1", "h1"]);
});

test("first name", () => {
  assert.equal(firstName("Anna Muster"), "Anna");
  assert.equal(firstName("Anna"), "Anna");
  assert.equal(firstName("  Anna  Muster "), "Anna");
});
