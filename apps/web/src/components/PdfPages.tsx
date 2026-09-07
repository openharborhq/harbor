"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a PDF's pages onto canvases we control.
 *
 * The browser's built-in PDF viewer paints its own dark chrome inside the iframe and cannot be
 * restyled from the page, which is where the black frame around previews came from. Rendering
 * the pages ourselves removes it and makes every document look the same in every browser.
 * The bytes already reach the browser either way, so this changes nothing about exposure.
 */
export function PdfPages({ url, title }: { url: string; title: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

        const doc = await pdfjs.getDocument({ url, withCredentials: true }).promise;
        if (cancelled) return;
        setPageCount(doc.numPages);

        // Render at the container's width times the device pixel ratio so text stays crisp.
        const targetWidth = host.clientWidth || 800;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (targetWidth / base.width) * dpr });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.className = "block rounded-sm";
          canvas.setAttribute("aria-label", `${title} — page ${n} of ${doc.numPages}`);

          const wrapper = document.createElement("div");
          wrapper.className = "overflow-hidden rounded-sm bg-white shadow-[0_1px_3px_rgba(13,22,34,0.12)]";
          wrapper.appendChild(canvas);
          host.appendChild(wrapper);

          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas unavailable");
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          if (n === 1) setState("ready");
        }
        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();

    return () => {
      cancelled = true;
      if (host) host.replaceChildren();
    };
  }, [url, title]);

  return (
    <div className="h-full w-full overflow-y-auto">
      {state === "loading" && <p className="py-8 text-center text-small text-muted">Rendering the document…</p>}
      {state === "failed" && (
        <p className="py-8 text-center text-small text-muted">
          Couldn&rsquo;t render this document here.{" "}
          <a href={url} target="_blank" rel="noreferrer" className="font-medium text-accent">
            Open it full size
          </a>
          .
        </p>
      )}
      <div ref={hostRef} className="flex flex-col gap-4" />
      {state === "ready" && pageCount > 1 && <p className="py-3 text-center text-small text-muted">{pageCount} pages</p>}
    </div>
  );
}
