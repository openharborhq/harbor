import type { ItemKind } from "@trustworthier/shared";

/** People get their initial; things get a glyph, so a grid of both reads at a glance (spec §6). */
export function itemGlyph(kind: ItemKind, label: string): string {
  switch (kind) {
    case "person":
      return label.slice(0, 1).toUpperCase();
    case "property":
      return "⌂";
    case "vehicle":
      return "⛭";
    case "account":
      return "▤";
    case "policy":
      return "§";
    case "pet":
      return "❋";
    case "business":
      return "▲";
    default:
      return "•";
  }
}
