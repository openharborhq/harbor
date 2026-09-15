"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DocumentSummary } from "@harbor/shared";
import { PdfPages } from "@/components/PdfPages";
import { api } from "@/lib/api-client";
import type { BasketDocument } from "./ShareBasket";

/**
 * The document itself, beside the share being built (spec §10.5).
 *
 * Why it earns the space: a share hands real paperwork to someone outside the house, and the
 * titles in the list are the vault's own — often a model's suggestion, sometimes a filename. The
 * only way to be sure the right thing is going out is to look at it, and doing that by leaving the
 * dialog would mean starting the share again.
 *
 * **The real document, not its thumbnail.** It began as the 480px first-page image the worker
 * draws at upload, which this pane is wider than on any real screen — so every document looked
 * soft. It now renders the file the way the document viewer does: pdf.js onto a canvas at the
 * container's width times the device pixel ratio. Sharp at any size, every page rather than the
 * first, and nothing already filed has to be reprocessed for it.
 *
 * The cost is honest — the file is fetched and parsed in the browser, so a large scan takes a
 * moment. The thumbnail fills that gap rather than an empty frame, which turns the wait into
 * something already worth looking at.
 */
export function DocPreview({ document: doc }: { document: BasketDocument | null }) {
  const [summary, setSummary] = useState<DocumentSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    // The basket carries an id and a title; which renderer to use is a fact about the file.
    api<DocumentSummary>(`/documents/${doc.id}`)
      .then((d) => !cancelled && setSummary(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [doc]);

  if (!doc) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center p-8">
        <p className="max-w-[28ch] text-center text-small text-muted">Nothing to preview.</p>
      </div>
    );
  }

  const mime = summary?.file.mimeType ?? "";
  const fileUrl = `/api/documents/${doc.id}/file`;

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
          <p className="pt-8 text-center text-small text-muted">No preview for this one. It is still included in the share.</p>
        ) : mime === "application/pdf" ? (
          <PdfPages url={fileUrl} title={doc.title} />
        ) : mime.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileUrl} alt={doc.title} onError={() => setFailed(true)} className="mx-auto w-full rounded-md border border-border bg-ground" />
        ) : (
          /*
            Either the file's type has not arrived yet, or it is one neither renderer handles. The
            thumbnail covers both: something to look at immediately, and the only thing there is
            for a format with no page. Capped at the 480px it was drawn at rather than stretched.
          */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/documents/${doc.id}/thumbnail`}
            alt={`First page of ${doc.title}`}
            onError={() => setFailed(true)}
            className="mx-auto w-full max-w-[480px] rounded-md border border-border bg-ground"
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
