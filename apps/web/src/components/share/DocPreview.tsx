"use client";

import Link from "next/link";
import { useState } from "react";
import type { BasketDocument } from "./ShareBasket";

/**
 * The first page of a document, beside the share being built (spec §10.5).
 *
 * Why it earns the space: a share hands real documents to someone outside the house, and the
 * titles in the list are the vault's own — often a model's suggestion, sometimes a filename. The
 * only way to be sure the right paperwork is going out is to look at it, and doing that by leaving
 * the dialog would mean starting the share again.
 *
 * It is the same decrypted first-page image the library draws, asked for by id alone: the basket
 * carries a document's id and title and nothing else, and the version in the URL is only cache
 * busting. A document with no preview yet — still being read, or a format with no page — falls
 * back rather than showing a broken frame.
 */
export function DocPreview({ document: doc }: { document: BasketDocument | null }) {
  const [failed, setFailed] = useState(false);

  if (!doc) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center p-8">
        <p className="max-w-[28ch] text-center text-small text-muted">Nothing to preview.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <div className="label mb-1">Preview</div>
          <div className="truncate text-row font-semibold" title={doc.title}>
            {doc.title}
          </div>
        </div>
      </header>

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto p-5">
        {failed ? (
          <p className="pt-8 text-center text-small text-muted">
            No preview for this one yet. It is still included in the share.
          </p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/documents/${doc.id}/thumbnail`}
            alt={`First page of ${doc.title}`}
            onError={() => setFailed(true)}
            className="w-full rounded-md border border-border bg-ground"
          />
        )}
      </div>

      <footer className="shrink-0 border-t border-border px-5 py-3">
        <Link href={`/documents/${doc.id}`} target="_blank" className="text-small text-accent hover:underline">
          Open the document →
        </Link>
      </footer>
    </div>
  );
}
