import { notFound } from "next/navigation";
import { daysUntil, displayTitle, formatAmount, SHORT_MONTHS, todayIso, type ActivityEntry, type Category, type DocumentSummary, type DocumentText, type DocumentVersion, type Item, type Task } from "@harbor/shared";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DocumentFrame } from "@/components/DocumentFrame";
import { DocumentDetail } from "@/components/DocumentDetail";
import { DocumentSheet } from "@/components/DocumentSheet";
import { DocumentTasks } from "@/components/DocumentTasks";
import { PdfPages } from "@/components/PdfPages";
import { ScanChoice } from "@/components/ScanChoice";
import { isProcessing } from "@/components/StatusPill";
import { DocumentTitle } from "@/components/DocumentTitle";
import { ApiError, apiFetch } from "@/lib/api-server";

/**
 * One document, read (spec §4).
 *
 * The same thing twice over: as a modal over the list you opened it from, and as a page when the
 * URL was reached directly — a shared link, a bookmark, a refresh. Only the frame differs, so the
 * frame is the only thing that takes a variant.
 */
export async function DocumentView({ id, variant }: { id: string; variant: "page" | "modal" }) {
  let doc: DocumentSummary;
  try {
    doc = await apiFetch<DocumentSummary>(`/documents/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const [text, versions, activity, categories, items, tasks] = await Promise.all([
    apiFetch<DocumentText>(`/documents/${id}/text`),
    apiFetch<DocumentVersion[]>(`/documents/${id}/versions`),
    apiFetch<ActivityEntry[]>(`/documents/${id}/activity`),
    apiFetch<Category[]>("/categories"),
    apiFetch<Item[]>("/items"),
    apiFetch<Task[]>(`/tasks?document=${id}`).catch(() => [] as Task[]),
  ]);
  const f = doc.file;
  const originalUrl = `/api/documents/${doc.id}/file`;
  // A photo that was turned into a scan is shown, opened and downloaded as the scan (spec §2 stage
  // 1b) — that is what the person meant to keep — unless they chose the photo for this document.
  const showScan = f.hasScan && !f.preferOriginal;
  const fileUrl = showScan ? `${originalUrl}?copy=scan` : originalUrl;
  const isImage = !showScan && f.mimeType.startsWith("image/");
  // The scan is named after the document by the server; the original keeps the name it came with.
  const downloadAs = showScan ? true : f.originalFilename;
  const facts = keyFacts(doc, tasks);

  return (
    <DocumentFrame
      variant={variant}
      title={displayTitle(doc)}
      header={
        <div className="flex min-w-0 items-center justify-between gap-3 sm:gap-5">
          <div className="min-w-0">
            <DocumentTitle documentId={doc.id} title={displayTitle(doc)} />
            <p className="truncate text-small text-muted">
              <span className={doc.category ? "text-accent" : ""}>{doc.category ? doc.category.path : "Inbox"}</span>
              {doc.items.length ? ` · ${doc.items.map((p) => p.label).join(", ")}` : ""}
            </p>
          </div>
          {/*
            Both ways of taking the document somewhere else, together, where actions on this view
            belong. They were at the bottom of the preview, below the fold on a short window, and
            one of them was a second Download two inches from the first.
          */}
          <span className="flex shrink-0 items-center gap-2.5">
          {/* On a phone it is a row of the sheet instead, where there is room for it. */}
          {f.hasScan && <ScanChoice documentId={doc.id} preferOriginal={f.preferOriginal} variant="header" />}
          <span className="flex h-9 shrink-0 items-stretch divide-x divide-border overflow-hidden rounded-md border border-border">
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              title={showScan ? "Open the scan in a new tab" : "Open the original in a new tab"}
              className="flex items-center gap-1.5 px-3 text-row font-medium transition-colors hover:bg-surface"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
                <path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
              </svg>
              {/* Icons alone on a phone, where the title needs the width more. */}
              <span className="sr-only sm:not-sr-only">Full</span>
            </a>
            <a
              href={fileUrl}
              download={downloadAs}
              className="flex items-center gap-1.5 px-3 text-row font-medium transition-colors hover:bg-surface"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
              <span className="sr-only sm:not-sr-only">Download</span>
            </a>
          </span>
          </span>
        </div>
      }
    >
      <AutoRefresh active={isProcessing(f.processingStatus)} />

      {/*
        The preview takes whatever height the window has. It was a fixed 720px box inside a page
        that scrolled, which on a laptop meant scrolling to see the bottom of a page that would
        have fitted, and on a large screen meant grey space around a small one.

        Below lg the bottom padding is what the sheet overlaps, so the edge of the page tucks under
        it rather than the sheet hiding the last lines of the preview.
      */}
      <div className="flex h-[50svh] min-w-0 shrink-0 flex-col bg-surface px-5 pb-9 pt-3.5 sm:h-[60svh] sm:px-10 sm:pt-5 lg:h-auto lg:flex-1 lg:shrink lg:px-20 lg:py-6">
        {/*
          The whole pane is the mat, not a rounded card floating on white. A page sitting on its
          own tone reads as a page; the same page inside a panel inside a window is two frames
          around one document.
        */}
        <div className="flex min-h-0 flex-1 items-start justify-center overflow-hidden">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl} alt={doc.title} className="max-h-full max-w-full rounded-sm bg-white object-contain shadow-[0_1px_3px_rgba(13,22,34,0.12)]" />
          ) : showScan || f.mimeType === "application/pdf" ? (
            <PdfPages url={fileUrl} title={doc.title} />
          ) : (
            <p className="text-body text-muted">No preview for this file type. Download the original instead.</p>
          )}
        </div>
      </div>

      {/*
        Its own scroll: five tabs of metadata should never push the document out of view.

        No horizontal padding here — the panel inside insets its own content, so the tab rule can
        run the full width of the pane. The floor is set by the tablist, which is 444px once each
        tab carries its own padding; 480 leaves that comfortable rather than exact. It began at 360
        against a 364px tablist, with 48 of this pane's own padding taken out of the middle, and
        "Activity" was simply cut off.
      */}
      {/*
        Thirty per cent of the window, not a fixed 420px. The preview is the reason this view
        exists and should grow with the screen; a details column that stayed put turned a wide
        monitor into a wide document and the same narrow panel. The floor is what the widest field
        label and a date need side by side.

        Below lg it is under the document instead, full width, and scrolls with it.
      */}
      {/*
        Below lg the panel is behind "All details" in a sheet that leads with what the document is
        and what is left to do; from lg up the sheet draws nothing and the panel is the right-hand
        column, as it always was.
      */}
      <DocumentSheet
        top={
          <>
            <div className="flex flex-col gap-1 px-5 pt-2.5">
              <DocumentTitle documentId={doc.id} title={displayTitle(doc)} />
              {/* The category's own name: on a phone "Insurance › Auto" says less than "Auto" and costs a line. */}
              <p className="text-body text-muted">
                {doc.category ? doc.category.name : "Inbox"}
                {doc.items.length ? ` · ${doc.items.map((p) => p.label).join(", ")}` : ""}
              </p>
            </div>
            {facts.length > 0 && (
              <dl className="flex px-5 pt-[18px]">
                {facts.map((fact, i) => (
                  <div key={fact.label} className={`flex min-w-0 flex-1 basis-0 flex-col-reverse gap-0.5 pr-3 sm:max-w-[240px] ${i > 0 ? "border-l border-border pl-3.5" : ""}`}>
                    <dt className="text-body text-muted">{fact.label}</dt>
                    <dd className={`break-words text-lead font-bold tracking-snug ${fact.warn ? "text-warn" : ""}`}>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="px-5 pt-[18px]">
              <DocumentTasks documentId={doc.id} tasks={tasks} variant="sheet" />
            </div>
          </>
        }
        actions={
          <>
            <a
              href={fileUrl}
              download={downloadAs}
              className="flex h-[52px] flex-1 basis-0 items-center justify-center gap-2 rounded-lg border border-border-strong text-copy font-semibold transition-colors active:bg-surface"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[19px]" aria-hidden="true">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
              Download
            </a>
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-[52px] flex-1 basis-0 items-center justify-center gap-2 rounded-lg border border-border-strong text-copy font-semibold transition-colors active:bg-surface"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[19px]" aria-hidden="true">
                <path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
              </svg>
              Full size
            </a>
            {f.hasScan && <ScanChoice documentId={doc.id} preferOriginal={f.preferOriginal} variant="sheet" />}
          </>
        }
      >
        <aside className="scrollbar-none flex shrink-0 flex-col border-border py-1 lg:w-[30%] lg:min-w-[480px] lg:overflow-y-auto lg:border-l lg:py-5">
          <DocumentDetail doc={doc} text={text} versions={versions} activity={activity} categories={categories} items={items} tasks={tasks} />
        </aside>
      </DocumentSheet>
    </DocumentFrame>
  );
}

type Fact = { label: string; value: string; warn?: boolean };

/**
 * Up to three numbers worth seeing before anything else, on a phone. Only the ones the document
 * has — an empty "Expires —" column says nothing and takes a third of the width. An open to-do's
 * amount comes first because it is the one that asks for something; the page count is what goes
 * when there are already three.
 */
function keyFacts(doc: DocumentSummary, tasks: Task[]): Fact[] {
  const today = todayIso();
  const facts: Fact[] = [];
  const owed = tasks.find((t) => t.status === "open" && t.amountCents !== null);
  // Whole amounts without their cents: "€1,250.00" at 21px bold fills a third of a phone on its
  // own. The exact figure is in the to-do directly below.
  const amount = owed ? formatAmount(owed.amountCents, owed.currency)?.replace(/\.00(?=\D*$)/, "") : null;
  if (amount) facts.push({ label: "Due", value: amount });
  if (doc.documentDate) facts.push({ label: "Dated", value: factDate(doc.documentDate, today) });
  if (doc.expiresAt) {
    const left = daysUntil(doc.expiresAt, today);
    facts.push({ label: left < 0 ? "Expired" : "Expires", value: factDate(doc.expiresAt, today), warn: left <= 90 });
  }
  if (doc.file.pageCount) facts.push({ label: doc.file.pageCount === 1 ? "Page" : "Pages", value: String(doc.file.pageCount) });
  return facts.slice(0, 3);
}

/**
 * A date that fits a third of a phone at 21px bold. "12 Mar 2031" does not; "Mar 2031" does, and
 * a month is the right precision for a date that far off — the day is one tap away under "All
 * details". This year's dates, and the next few months', keep the day, because there it matters.
 */
function factDate(iso: string, today: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const month = SHORT_MONTHS[d.getUTCMonth()];
  const days = daysUntil(iso, today);
  const near = iso.slice(0, 4) === today.slice(0, 4) || (days > 0 && days <= 120);
  return near ? `${d.getUTCDate()} ${month}` : `${month} ${d.getUTCFullYear()}`;
}
