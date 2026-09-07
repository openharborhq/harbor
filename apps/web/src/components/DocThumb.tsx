"use client";

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
}: {
  documentId: string;
  hasThumbnail: boolean;
  /** Bust the browser cache when a new version lands. */
  version: number;
  width: number;
  height: number;
  dim?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const show = hasThumbnail && !failed;
  return (
    <div
      style={{ width, height }}
      className={`shrink-0 overflow-hidden rounded-md border border-border bg-ground ${dim ? "opacity-55" : ""} ${className}`}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/documents/${documentId}/thumbnail?v=${version}`} alt="" width={width} height={height} onError={() => setFailed(true)} className="h-full w-full object-cover object-top" />
      ) : (
        <Placeholder scale={width / 200} />
      )}
    </div>
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
