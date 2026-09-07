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

export function isProcessing(status: ProcessingStatus): boolean {
  return status === "queued" || status === "extracting" || status === "ocr" || status === "indexing" || status === "suggesting";
}
