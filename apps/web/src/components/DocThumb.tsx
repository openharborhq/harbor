"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * First-page preview served decrypted by the API. Falls back to the design's line-art
 * placeholder while processing or when no preview exists.
 */
export function DocThumb({
  documentId,
  hasThumbnail,
  version,
  width,
  height,
  dim = false,
  className = "",
  href,
  label,
}: {
  documentId: string;
  hasThumbnail: boolean;
  /** Bust the browser cache when a new version lands. */
  version: number;
  width: number;
  height: number;
  dim?: boolean;
  className?: string;
  /** Makes the preview open something. A page of a document looks clickable, so it should be. */
  href?: string;
  /** The document's title. A link whose only content is a decorative image has no name without it. */
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  const show = hasThumbnail && !failed;

  const preview = (
    <div
      style={{ width, height }}
      className={`overflow-hidden rounded-md border border-border bg-ground ${dim ? "opacity-55" : ""} ${href ? "transition-colors group-hover:border-border-strong" : ""} ${className}`}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/documents/${documentId}/thumbnail?v=${version}`} alt="" width={width} height={height} onError={() => setFailed(true)} className="h-full w-full object-cover object-top" />
      ) : (
        <Placeholder scale={width / 200} />
      )}
    </div>
  );

  if (!href) return <div className="shrink-0">{preview}</div>;
  return (
    <Link href={href} aria-label={label ? `Open ${label}` : "Open document"} className="group shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      {preview}
    </Link>
  );
}

function Placeholder({ scale }: { scale: number }) {
  const s = (n: number) => `${n * scale}px`;
  const line = (w: number, strong = false) => <div style={{ height: s(6), width: `${w}%` }} className={`rounded-sm ${strong ? "bg-border-strong" : "bg-border"}`} />;
  return (
    <div style={{ padding: s(20), gap: s(8) }} className="flex h-full w-full flex-col">
      <div style={{ height: s(10), width: "28%" }} className="rounded-sm bg-text" />
      {line(40, true)}
      <div style={{ height: s(8) }} />
      {line(100)}
      {line(100)}
      {line(66)}
      <div style={{ height: s(8) }} />
      {line(100)}
      {line(100)}
      {line(50)}
    </div>
  );
}
