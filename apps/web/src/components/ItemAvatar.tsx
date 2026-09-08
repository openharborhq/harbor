import type { ItemKind } from "@harbor/shared";
import { itemGlyph } from "@/lib/item-glyph";

/**
 * A person or a thing, as a circle: their photo when there is one, their initial or glyph when
 * there is not.
 *
 * A plain <img> rather than next/image on purpose. The photo is served by the API from an
 * encrypted blob and is private to this vault, so it must be fetched by the browser with the
 * session cookie — Next's optimiser would fetch it server-side, without one, and get a 401.
 */
export function ItemAvatar({
  item,
  size,
  textSize,
}: {
  item: { id: string; kind: ItemKind; label: string; avatarUpdatedAt: string | null };
  size: number;
  textSize: string;
}) {
  const frame = "flex shrink-0 items-center justify-center overflow-hidden rounded-pill bg-surface";
  if (item.avatarUpdatedAt) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- see the note above.
      <img
        src={`/api/items/${item.id}/avatar?v=${Date.parse(item.avatarUpdatedAt)}`}
        alt={item.label}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={`${frame} object-cover`}
      />
    );
  }
  return (
    <div style={{ width: size, height: size }} className={`${frame} ${textSize} font-semibold text-muted`} aria-hidden>
      {itemGlyph(item.kind, item.label)}
    </div>
  );
}
