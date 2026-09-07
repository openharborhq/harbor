import type { ItemKind } from "@harbor/shared";

/** Kind glyphs for the FOR control, traced from the Paper artboard "Inbox — For people and things". */
export function ItemIcon({ kind, size = 13, className = "" }: { kind: ItemKind; size?: number; className?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className: `shrink-0 ${className}` };
  switch (kind) {
    case "person":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 21v-1a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v1" />
        </svg>
      );
    case "property":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z" />
        </svg>
      );
    case "vehicle":
      return (
        <svg {...common}>
          <path d="M4 16v3M20 16v3" />
          <path d="M3 16v-3.5L5 7h14l2 5.5V16H3Z" />
          <path d="M6.5 12.5h.01M17.5 12.5h.01" />
        </svg>
      );
    case "account":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M7 4h10l1.5 5H5.5L7 4Z" />
          <rect x="4" y="9" width="16" height="7" rx="2" />
        </svg>
      );
  }
}
