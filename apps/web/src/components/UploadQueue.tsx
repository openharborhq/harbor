"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Category, DocumentSummary, Person, UploadResult } from "@trustworthier/shared";
import { api, sha256Hex, uploadFile } from "@/lib/api-client";
import { formatBytes, formatDate } from "@/lib/format";
import { isProcessing } from "./StatusPill";

type Phase =
  | { kind: "hashing" }
  | { kind: "waiting" }
  | { kind: "duplicate"; of: NonNullable<UploadResult["duplicateOf"]> }
  | { kind: "uploading"; fraction: number }
  | { kind: "processing"; doc: DocumentSummary }
  | { kind: "ready"; doc: DocumentSummary }
  | { kind: "failed"; message: string }
  | { kind: "unsupported" }
  | { kind: "skipped" }
  | { kind: "cancelled" };

interface Item {
  id: string;
  file: File;
  phase: Phase;
  /** Set when the user chose "Add as new version" for a duplicate. */
  versionOf?: string;
}

interface Defaults {
  categoryId: string;
  personIds: string[];
  tags: string;
}

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic";
const SUPPORTED = /\.(pdf|jpe?g|png|heic)$/i;
const MAX_BYTES = 200 * 1024 * 1024;
const CONCURRENCY = 3;

export function UploadQueue({ categories, people }: { categories: Category[]; people: Person[] }) {
  const [items, setItems] = useState<Item[]>([]);
  const [defaults, setDefaults] = useState<Defaults>({ categoryId: "", personIds: [], tags: "" });
  const [paused, setPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Map<string, AbortController>());

  const update = useCallback((id: string, patch: Partial<Item> | ((it: Item) => Partial<Item>)) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...(typeof patch === "function" ? patch(it) : patch) } : it)));
  }, []);

  const runUpload = useCallback(
    async (item: Item, d: Defaults) => {
      const ac = new AbortController();
      controllers.current.set(item.id, ac);
      update(item.id, { phase: { kind: "uploading", fraction: 0 } });
      try {
        const result = await uploadFile<UploadResult>(item.file, {
          signal: ac.signal,
          onProgress: (fraction) => update(item.id, { phase: { kind: "uploading", fraction } }),
          fields: {
            versionOf: item.versionOf,
            categoryId: item.versionOf ? undefined : d.categoryId || undefined,
            personIds: item.versionOf ? undefined : d.personIds,
            tags: item.versionOf ? undefined : d.tags.split(",").map((t) => t.trim()).filter(Boolean),
          },
        });
        update(item.id, { phase: { kind: "processing", doc: result.document } });
      } catch (err) {
        const cancelled = (err as { cancelled?: boolean }).cancelled;
        update(item.id, { phase: cancelled ? { kind: "cancelled" } : { kind: "failed", message: (err as Error).message } });
      } finally {
        controllers.current.delete(item.id);
      }
    },
    [update],
  );

  // Scheduler: at most CONCURRENCY uploads in flight, oldest waiting first, nothing while paused.
  // Deferred a tick so state transitions never happen synchronously inside the effect.
  useEffect(() => {
    if (paused) return;
    const inFlight = items.filter((it) => it.phase.kind === "uploading").length;
    const slots = CONCURRENCY - inFlight;
    if (slots <= 0) return;
    const next = [...items].reverse().filter((it) => it.phase.kind === "waiting").slice(0, slots);
    if (next.length === 0) return;
    const t = setTimeout(() => {
      for (const it of next) void runUpload(it, defaults);
    }, 0);
    return () => clearTimeout(t);
  }, [items, paused, defaults, runUpload]);

  const add = useCallback(
    async (files: FileList | File[]) => {
      const fresh: Item[] = Array.from(files).map((file) => ({
        id: crypto.randomUUID(),
        file,
        phase: !SUPPORTED.test(file.name) ? { kind: "unsupported" } : file.size > MAX_BYTES ? { kind: "failed", message: "Larger than 200 MB" } : { kind: "hashing" },
      }));
      setItems((prev) => [...fresh, ...prev]);
      for (const it of fresh) {
        if (it.phase.kind !== "hashing") continue;
        try {
          const sha = await sha256Hex(it.file);
          const { duplicateOf } = await api<{ duplicateOf: UploadResult["duplicateOf"] }>(`/documents/duplicates?sha256=${sha}`);
          update(it.id, { phase: duplicateOf ? { kind: "duplicate", of: duplicateOf } : { kind: "waiting" } });
        } catch (err) {
          update(it.id, { phase: { kind: "failed", message: (err as Error).message } });
        }
      }
    },
    [update],
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
            update(it.id, { phase: doc.file.processingStatus === "ready" ? { kind: "ready", doc } : { kind: "failed", message: doc.file.processingError ?? "Processing failed" } });
          } else update(it.id, { phase: { kind: "processing", doc } });
        } catch {
          /* transient; next tick */
        }
      }
    }, 2000);
    return () => clearInterval(t);
  }, [items, update]);

  function cancelRemaining() {
    setItems((prev) => prev.map((it) => (it.phase.kind === "waiting" || it.phase.kind === "hashing" ? { ...it, phase: { kind: "cancelled" } } : it)));
    for (const ac of controllers.current.values()) ac.abort();
  }

  const done = items.filter((it) => ["ready", "skipped"].includes(it.phase.kind)).length;
  const active = items.filter((it) => ["hashing", "uploading", "processing"].includes(it.phase.kind)).length;
  const waiting = items.filter((it) => it.phase.kind === "waiting").length;
  const decisions = items.filter((it) => it.phase.kind === "duplicate").length;
  const failed = items.filter((it) => it.phase.kind === "failed").length;

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

      <div className="flex items-center gap-8 rounded-md border border-border px-5 py-4">
        <div className="w-[236px] shrink-0">
          <div className="text-row font-semibold">Apply to this batch</div>
          <div className="text-small text-muted">Files with a category skip the Inbox.</div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="label">For</span>
          <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border bg-ground px-2 py-1">
            {people.length === 0 && <span className="px-1 text-row text-muted">Anyone</span>}
            {people.map((p) => {
              const on = defaults.personIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDefaults((d) => ({ ...d, personIds: on ? d.personIds.filter((x) => x !== p.id) : [...d.personIds, p.id] }))}
                  className={`h-6 rounded-sm px-2 text-small font-semibold ${on ? "bg-accent-soft text-accent" : "bg-surface text-muted hover:text-text"}`}
                >
                  {p.displayName}
                </button>
              );
            })}
          </div>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">File to</span>
          <select
            value={defaults.categoryId}
            onChange={(e) => setDefaults((d) => ({ ...d, categoryId: e.target.value }))}
            className={`h-9 w-[240px] rounded-md border border-border bg-ground px-3 text-row ${defaults.categoryId ? "" : "text-muted"}`}
          >
            <option value="">Inbox — decide later</option>
            {categories
              .filter((c) => c.parentId === null)
              .map((top) => (
                <optgroup key={top.id} label={top.name}>
                  <option value={top.id}>{top.name}</option>
                  {categories
                    .filter((c) => c.parentId === top.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {top.name} › {c.name}
                      </option>
                    ))}
                </optgroup>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Tags</span>
          <input
            value={defaults.tags}
            onChange={(e) => setDefaults((d) => ({ ...d, tags: e.target.value }))}
            placeholder="+ Tag, another"
            className="h-9 w-[200px] rounded-md border border-dashed border-border-strong bg-ground px-3 text-row placeholder:text-muted"
          />
        </label>
      </div>

      {items.length > 0 && (
        <section className="flex flex-col gap-3.5">
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-section font-semibold tracking-snug">Uploading</h2>
              <span className="text-small text-muted">
                {done} of {items.length} done
                {active ? ` · ${active} in progress` : ""}
                {decisions ? ` · ${decisions} need${decisions === 1 ? "s" : ""} a decision` : ""}
                {waiting ? ` · ${waiting} waiting` : ""}
                {failed ? ` · ${failed} failed` : ""}
              </span>
            </div>
            <div className="flex gap-5">
              {(waiting > 0 || active > 0) && (
                <button type="button" onClick={() => setPaused((p) => !p)} className="text-row font-medium text-accent">
                  {paused ? "Resume" : "Pause"}
                </button>
              )}
              {(waiting > 0 || active > 0) && (
                <button type="button" onClick={cancelRemaining} className="text-row font-medium text-muted">
                  Cancel remaining
                </button>
              )}
            </div>
          </div>
          <div className="h-1 overflow-hidden rounded-pill bg-surface">
            <div className="h-1 rounded-pill bg-accent transition-[width]" style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
          </div>
          <ul className="flex flex-col border-b border-border">
            {items.map((it) => (
              <Row
                key={it.id}
                item={it}
                paused={paused}
                onDecide={(keep) => update(it.id, keep ? { phase: { kind: "waiting" }, versionOf: it.phase.kind === "duplicate" ? it.phase.of.documentId : undefined } : { phase: { kind: "skipped" } })}
                onRetry={() => update(it.id, { phase: { kind: "waiting" } })}
              />
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

function Row({ item, paused, onDecide, onRetry }: { item: Item; paused: boolean; onDecide: (keep: boolean) => void; onRetry: () => void }) {
  const { file, phase } = item;
  return (
    <li className="flex h-16 items-center gap-3.5 border-t border-border">
      <div className="h-[38px] w-[30px] shrink-0 rounded-sm border border-border bg-surface" />
      <div className="w-[340px] shrink-0">
        <div className="truncate text-row font-semibold">{file.name}</div>
        <div className="text-small text-muted">
          {formatBytes(file.size)}
          {item.versionOf ? " · new version" : ""}
        </div>
      </div>
      <div className="min-w-0 flex-1 text-small">
        {phase.kind === "hashing" && <span className="text-muted">Checking whether you already have this…</span>}
        {phase.kind === "waiting" && <span className="text-muted">{paused ? "Paused" : "Waiting — starts as the others finish"}</span>}
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
                : phase.doc.file.processingStatus === "suggesting"
                  ? "Thinking about where it goes"
                  : "Reading the document"}
            </span>
            <Bar fraction={phase.doc.file.processingStatus === "suggesting" ? 0.9 : (phase.doc.file.pageProgress ?? 0.08)} />
          </div>
        )}
        {phase.kind === "ready" && (
          <span>
            {phase.doc.file.pageCount ? `${phase.doc.file.pageCount} page${phase.doc.file.pageCount === 1 ? "" : "s"} · ` : ""}
            {phase.doc.category ? `Filed to ${phase.doc.category.path}` : "Ready — in your Inbox"}
            {phase.doc.file.version > 1 ? ` · version ${phase.doc.file.version}` : ""}
          </span>
        )}
        {phase.kind === "duplicate" && (
          <span className="flex items-center gap-2 font-medium text-warn">
            <WarnIcon /> Duplicate of &ldquo;{phase.of.title}&rdquo;, added {formatDate(phase.of.addedAt)}
          </span>
        )}
        {phase.kind === "unsupported" && <span className="text-muted">Not a PDF or photo — stored nowhere. Export it as PDF and try again.</span>}
        {phase.kind === "failed" && <span className="text-warn">{phase.message}</span>}
        {phase.kind === "skipped" && <span className="text-muted">Skipped</span>}
        {phase.kind === "cancelled" && <span className="text-muted">Cancelled</span>}
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
        ) : phase.kind === "failed" || phase.kind === "cancelled" ? (
          <>
            <button type="button" onClick={onRetry} className="h-[30px] rounded-md border border-border bg-ground px-3 text-small font-medium">
              {phase.kind === "failed" ? "Try again" : "Resume"}
            </button>
            <Pill phase={phase} />
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
        : phase.kind === "unsupported"
          ? ["Unsupported", "bg-warn-soft text-warn"]
          : phase.kind === "skipped" || phase.kind === "cancelled"
            ? [phase.kind === "skipped" ? "Skipped" : "Cancelled", "bg-surface text-muted"]
            : phase.kind === "processing"
              ? ["Making searchable", "bg-surface text-muted"]
              : phase.kind === "waiting"
                ? ["Waiting", "bg-surface text-muted"]
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
