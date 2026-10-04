/**
 * A field label in the document panel: sentence case at 15px on a phone, the design's small
 * uppercase `.label` from lg up.
 *
 * Spelled out in utilities rather than as `lg:label`, because `.label` is a plain class in
 * globals.css, not a Tailwind utility, and takes no variant. The size is `text-(length:…)` because
 * `text-label` on its own is the green label *colour* — the two namespaces share the name.
 */
export const FIELD_LABEL =
  "text-body font-semibold text-muted lg:text-(length:--text-label) lg:leading-(--text-label--line-height) lg:font-bold lg:uppercase lg:tracking-label";
