"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentSummary, UploadResult } from "@trustworthier/shared";
import { api, sha256Hex, uploadFile } from "@/lib/api-client";
import { formatBytes, formatDate } from "@/lib/format";
import { isProcessing } from "./StatusPill";

type Phase =
  | { kind: "hashing" }
  | { kind: "duplicate"; of: NonNullable<UploadResult["duplicateOf"]> }
  | { kind: "uploading"; fraction: number }
  | { kind: "processing"; doc: DocumentSummary }
  | { kind: "ready"; doc: DocumentSummary }
  | { kind: "failed"; message: string }
  | { kind: "skipped" };

interface Item {
  id: string;
  file: File;
  phase: Phase;
}

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic";

export function UploadQueue() {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = useCallback((id: string, phase: Phase) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, phase } : it)));
  }, []);

  const startUpload = useCallback(
    async (id: string, file: File) => {
      try {
        update(id, { kind: "uploading", fraction: 0 });
        const result = await uploadFile<UploadResult>(file, (fraction) => update(id, { kind: "uploading", fraction }));
        update(id, { kind: "processing", doc: result.document });
      } catch (err) {
        update(id, { kind: "failed", message: (err as Error).message });
      }
    },
    [update],
  );

  const add = useCallback(
    async (files: FileList | File[]) => {
      const fresh: Item[] = Array.from(files).map((file) => ({ id: crypto.randomUUID(), file, phase: { kind: "hashing" } }));
      setItems((prev) => [...fresh, ...prev]);
      for (const it of fresh) {
        try {
          const sha = await sha256Hex(it.file);
          const { duplicateOf } = await api<{ duplicateOf: UploadResult["duplicateOf"] }>(`/documents/duplicates?sha256=${sha}`);
          if (duplicateOf) update(it.id, { kind: "duplicate", of: duplicateOf });
          else void startUpload(it.id, it.file);
        } catch (err) {
          update(it.id, { kind: "failed", message: (err as Error).message });
        }
      }
    },
    [startUpload, update],
  );

  // Poll documents that are still processing.
  useEffect(() => {
    const pending = items.filter((it) => it.phase.kind === "processing");
    if (pending.length === 0) return;
    const t = setInterval(async () => {
      for (const it of pending) {
        if (it.phase.kind !== "processing") continue;
        try {
          const doc = await api<DocumentSummary>(`/documents/${it.phase.doc.id}`);
          if (!isProcessing(doc.file.processingStatus)) {
            update(it.id, doc.file.processingStatus === "ready" ? { kind: "ready", doc } : { kind: "failed", message: doc.file.processingError ?? "Processing failed" });
          } else update(it.id, { kind: "processing", doc });
        } catch {
          /* transient; try again next tick */
        }
      }
    }, 2000);
    return () => clearInterval(t);
  }, [items, update]);

  const done = items.filter((it) => it.phase.kind === "ready" || it.phase.kind === "skipped").length;
  const active = items.filter((it) => ["hashing", "uploading", "processing"].includes(it.phase.kind)).length;
  const decisions = items.filter((it) => it.phase.kind === "duplicate").length;

  return (
    <div className="flex flex-col gap-10">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void add(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex h-[236px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-surface ${dragging ? "border-accent" : "border-border-strong"}`}
      >
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
          <path d="M18 23V8.5M11.5 15 18 8.5l6.5 6.5M7 22.5v3.5a3 3 0 0 0 3 3h16a3 3 0 0 0 3-3v-3.5" />
        </svg>
        <div className="mt-1.5 text-section font-semibold tracking-snug">Drop files or folders here</div>
        <div className="text-body">
          <span className="text-muted">or </span>
          <span className="font-semibold text-accent">browse this computer</span>
        </div>
        <div className="mt-2.5 text-small text-muted">PDF, JPG, PNG, HEIC · up to 200 MB each · scanned pages are made searchable automatically</div>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && void add(e.target.files)} />
      </div>

      {items.length > 0 && (
        <section className="flex flex-col gap-3.5">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-section font-semibold tracking-snug">Uploading</h2>
            <span className="text-small text-muted">
              {done} of {items.length} done{active ? ` · ${active} in progress` : ""}{decisions ? ` · ${decisions} need${decisions === 1 ? "s" : ""} a decision` : ""}
            </span>
          </div>
          <ul className="flex flex-col border-b border-border">
            {items.map((it) => (
              <Row key={it.id} item={it} onDecide={(keep) => (keep ? void startUpload(it.id, it.file) : update(it.id, { kind: "skipped" }))} />
            ))}
          </ul>
          <p className="mt-2 flex items-center gap-2.5 text-small text-muted">
            <LockIcon /> Encrypted the moment it lands on the appliance. Originals are never altered — the searchable copy is stored alongside.
          </p>
        </section>
      )}
    </div>
  );
}

function Row({ item, onDecide }: { item: Item; onDecide: (keep: boolean) => void }) {
  const { file, phase } = item;
  return (
    <li className="flex h-16 items-center gap-3.5 border-t border-border">
      <div className="h-[38px] w-[30px] shrink-0 rounded-sm border border-border bg-surface" />
      <div className="w-[340px] shrink-0">
        <div className="truncate text-row font-semibold">{file.name}</div>
        <div className="text-small text-muted">{formatBytes(file.size)}</div>
      </div>
      <div className="min-w-0 flex-1 text-small">
        {phase.kind === "hashing" && <span className="text-muted">Checking whether you already have this…</span>}
        {phase.kind === "uploading" && (
          <div className="flex flex-col gap-1.5">
            <span>Uploading · {Math.round(phase.fraction * 100)}%</span>
            <Bar fraction={phase.fraction} />
          </div>
        )}
        {phase.kind === "processing" && (
          <div className="flex flex-col gap-1.5">
            <span>
              {phase.doc.file.processingStatus === "ocr" && phase.doc.file.pageCount
                ? `Reading page ${Math.max(1, Math.round((phase.doc.file.pageProgress ?? 0) * phase.doc.file.pageCount))} of ${phase.doc.file.pageCount}`
                : "Reading the document"}
            </span>
            <Bar fraction={phase.doc.file.pageProgress ?? 0.08} />
          </div>
        )}
        {phase.kind === "ready" && (
          <span>
            {phase.doc.file.pageCount ? `${phase.doc.file.pageCount} page${phase.doc.file.pageCount === 1 ? "" : "s"} · ` : ""}Ready — in your Inbox
          </span>
        )}
        {phase.kind === "duplicate" && (
          <span className="flex items-center gap-2 font-medium text-warn">
            <WarnIcon /> Duplicate of &ldquo;{phase.of.title}&rdquo;, added {formatDate(phase.of.addedAt)}
          </span>
        )}
        {phase.kind === "failed" && <span className="text-warn">{phase.message}</span>}
        {phase.kind === "skipped" && <span className="text-muted">Skipped</span>}
      </div>
      <div className="flex w-[196px] shrink-0 items-center justify-end gap-3.5">
        {phase.kind === "duplicate" ? (
          <>
            <button type="button" onClick={() => onDecide(true)} className="h-[30px] rounded-md border border-border bg-ground px-3 text-small font-medium">
              Add as new version
            </button>
            <button type="button" onClick={() => onDecide(false)} className="text-small font-medium text-muted">
              Skip
            </button>
          </>
        ) : (
          <Pill phase={phase} />
        )}
      </div>
    </li>
  );
}

function Pill({ phase }: { phase: Phase }) {
  const [label, tone] =
    phase.kind === "ready"
      ? ["Done", "bg-accent-soft text-accent"]
      : phase.kind === "failed"
        ? ["Failed", "bg-warn-soft text-warn"]
        : phase.kind === "skipped"
          ? ["Skipped", "bg-surface text-muted"]
          : phase.kind === "processing"
            ? ["Making searchable", "bg-surface text-muted"]
            : ["Preparing", "bg-surface text-muted"];
  return <span className={`inline-flex h-[22px] items-center rounded-pill px-2.5 text-label font-semibold ${tone}`}>{label}</span>;
}

function Bar({ fraction }: { fraction: number }) {
  return (
    <div className="h-1 w-[260px] overflow-hidden rounded-pill bg-surface">
      <div className="h-1 rounded-pill bg-accent transition-[width]" style={{ width: `${Math.round(Math.min(1, fraction) * 100)}%` }} />
    </div>
  );
}

function WarnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0">
      <path d="M8 2.5 14 13H2L8 2.5Z" strokeLinejoin="round" />
      <path d="M8 6.5v3M8 11.2v.3" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="shrink-0">
      <rect x="3" y="7" width="10" height="7" rx="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
