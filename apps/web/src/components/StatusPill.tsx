import type { ProcessingStatus } from "@harbor/shared";

const LABEL: Record<ProcessingStatus, string> = {
  queued: "Waiting",
  extracting: "Reading",
  ocr: "Making searchable",
  indexing: "Indexing",
  suggesting: "Suggesting",
  ready: "Ready",
  failed: "Needs attention",
};

export function StatusPill({ status }: { status: ProcessingStatus }) {
  const tone =
    status === "ready" ? "bg-accent-soft text-accent" : status === "failed" ? "bg-warn-soft text-warn" : "bg-surface text-muted";
  return (
    <span className={`inline-flex h-[22px] items-center rounded-pill px-2.5 text-label font-semibold ${tone}`}>{LABEL[status]}</span>
  );
}

/**
 * The same pill in a list, where it says nothing most of the time.
 *
 * Once a document has been through the pipeline its status is `ready`, and it stays that way
 * forever — so in a list of two hundred documents the column reads "Ready" two hundred times and
 * earns none of its width. What is worth a row's attention is a document still being worked on, or
 * one that failed, and those are exactly the states this still draws.
 */
export function ListStatusPill({ status }: { status: ProcessingStatus }) {
  if (status === "ready") return null;
  return <StatusPill status={status} />;
}

export function isProcessing(status: ProcessingStatus): boolean {
  return status === "queued" || status === "extracting" || status === "ocr" || status === "indexing" || status === "suggesting";
}
