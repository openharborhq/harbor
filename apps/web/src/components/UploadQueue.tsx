"use client";

import { type DragEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Category, DocumentSummary, Item, UploadResult } from "@harbor/shared";
import { ItemPicker } from "./ItemPicker";
import { api, sha256Hex, uploadFile } from "@/lib/api-client";
import { formatBytes, formatDate } from "@/lib/format";
import { DocThumb } from "./DocThumb";
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

/** One file in the upload queue — not a vault Item (spec §6), which is what `items` holds. */
interface QueueEntry {
  id: string;
  file: File;
  phase: Phase;
  /** Set when the user chose "Add as new version" for a duplicate. */
  versionOf?: string;
}

interface Defaults {
  categoryId: string;
  itemIds: string[];
  tags: string;
}

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic";
const SUPPORTED = /\.(pdf|jpe?g|png|heic)$/i;
const MAX_BYTES = 200 * 1024 * 1024;
const CONCURRENCY = 3;

export function UploadQueue({ categories, items }: { categories: Category[]; items: Item[] }) {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [defaults, setDefaults] = useState<Defaults>({ categoryId: "", itemIds: [], tags: "" });
  const [paused, setPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Map<string, AbortController>());

  const update = useCallback((id: string, patch: Partial<QueueEntry> | ((it: QueueEntry) => Partial<QueueEntry>)) => {
    setQueue((prev) => prev.map((it) => (it.id === id ? { ...it, ...(typeof patch === "function" ? patch(it) : patch) } : it)));
  }, []);

  const runUpload = useCallback(
    async (item: QueueEntry, d: Defaults) => {
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
            itemIds: item.versionOf ? undefined : d.itemIds,
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
    const inFlight = queue.filter((it) => it.phase.kind === "uploading").length;
    const slots = CONCURRENCY - inFlight;
    if (slots <= 0) return;
    const next = [...queue].reverse().filter((it) => it.phase.kind === "waiting").slice(0, slots);
    if (next.length === 0) return;
    const t = setTimeout(() => {
      for (const it of next) void runUpload(it, defaults);
    }, 0);
    return () => clearTimeout(t);
  }, [queue, paused, defaults, runUpload]);

  const add = useCallback(
    async (files: FileList | File[]) => {
      const fresh: QueueEntry[] = Array.from(files).map((file) => ({
        id: crypto.randomUUID(),
        file,
        phase: !SUPPORTED.test(file.name) ? { kind: "unsupported" } : file.size > MAX_BYTES ? { kind: "failed", message: "Larger than 200 MB" } : { kind: "hashing" },
      }));
      setQueue((prev) => [...fresh, ...prev]);
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
    const pending = queue.filter((it) => it.phase.kind === "processing");
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
  }, [queue, update]);

  function cancelRemaining() {
    setQueue((prev) => prev.map((it) => (it.phase.kind === "waiting" || it.phase.kind === "hashing" ? { ...it, phase: { kind: "cancelled" } } : it)));
    for (const ac of controllers.current.values()) ac.abort();
  }

  const done = queue.filter((it) => ["ready", "skipped"].includes(it.phase.kind)).length;
  const active = queue.filter((it) => ["hashing", "uploading", "processing"].includes(it.phase.kind)).length;
  const waiting = queue.filter((it) => it.phase.kind === "waiting").length;
  const decisions = queue.filter((it) => it.phase.kind === "duplicate").length;
  const failed = queue.filter((it) => it.phase.kind === "failed").length;

  const dropTarget = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length) void add(e.dataTransfer.files);
    },
  };

  // What the collapsed "Filing options" row says, so a batch headed somewhere other than the Inbox
  // is visible without opening it.
  const category = categories.find((c) => c.id === defaults.categoryId);
  const forLabels = items.filter((i) => defaults.itemIds.includes(i.id)).map((i) => i.label);
  const tagCount = defaults.tags.split(",").filter((t) => t.trim()).length;
  const filingSummary = [
    category ? `To ${category.name}` : "Inbox — decide later",
    ...(forLabels.length ? [`For ${forLabels.join(", ")}`] : []),
    ...(tagCount ? [`${tagCount} tag${tagCount === 1 ? "" : "s"}`] : []),
  ].join(" · ");

  return (
    <div className="flex flex-col lg:gap-10">
      {/* Below lg: three ways in instead of a drop zone — a phone has nothing to drag from, and
          "browse this computer" is not what it has. Each row opens the system picker already
          pointed at the right place; all three feed the same queue. The list still accepts a drop,
          for a tablet with a mouse. */}
      <div {...dropTarget} className={`flex flex-col rounded-lg lg:hidden ${dragging ? "outline-2 outline-offset-4 outline-accent" : ""}`}>
        <PickRow
          onClick={() => cameraRef.current?.click()}
          title="Take a photo"
          hint="Made searchable automatically"
          filled
          icon={
            <>
              <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
              <circle cx="12" cy="12.5" r="3.2" />
            </>
          }
        />
        <PickRow
          onClick={() => photosRef.current?.click()}
          title="Choose from Photos"
          hint="Scans and screenshots"
          icon={
            <>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <circle cx="9" cy="10" r="2" />
              <path d="m21 16-5-5-9 9" />
            </>
          }
        />
        <PickRow
          onClick={() => inputRef.current?.click()}
          title="Browse Files"
          hint="PDF and images, up to 200 MB"
          icon={
            <>
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
              <path d="M14 3v5h5" />
            </>
          }
        />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && void add(e.target.files)} />
        <input ref={photosRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => e.target.files && void add(e.target.files)} />
      </div>

      <div
        {...dropTarget}
        onClick={() => inputRef.current?.click()}
        className={`hidden h-[236px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-surface px-4 text-center lg:flex ${dragging ? "border-accent" : "border-border-strong"}`}
      >
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
          <path d="M18 23V8.5M11.5 15 18 8.5l6.5 6.5M7 22.5v3.5a3 3 0 0 0 3 3h16a3 3 0 0 0 3-3v-3.5" />
        </svg>
        {/* A large touch screen (a tablet in landscape) has nothing to drag from and no computer to
            browse: the same box is a button that opens its file and photo picker. */}
        <div className="mt-1.5 text-section font-semibold tracking-snug pointer-coarse:hidden">Drop files or folders here</div>
        <div className="text-body pointer-coarse:hidden">
          <span className="text-muted">or </span>
          <span className="font-semibold text-accent">browse this computer</span>
        </div>
        <div className="mt-1.5 hidden text-section font-semibold tracking-snug text-accent pointer-coarse:block">Choose files or photos</div>
        <div className="mt-2.5 text-small text-muted">PDF, JPG, PNG, HEIC · up to 200 MB each · scanned pages are made searchable automatically</div>
      </div>
      {/* Shared by the drop zone and the "Browse Files" row, and outside both: a click on an input
          inside the zone would bubble back to the zone's own click handler. */}
      <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && void add(e.target.files)} />

      {/* Below lg the batch settings sit behind one row: most photos go to the Inbox as they are,
          and three fields under the buttons would push the upload list off the screen. The row
          says where the batch is headed, so a batch going elsewhere is never a surprise. */}
      <div className="flex flex-col lg:block">
        <button
          type="button"
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen((o) => !o)}
          className="flex min-h-[52px] items-center gap-3 border-b border-border py-2 text-left lg:hidden"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-copy font-semibold">Filing options</span>
            <span className="block truncate text-body text-muted">{filingSummary}</span>
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-muted transition-transform ${optionsOpen ? "rotate-180" : ""}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

      {/* Wraps rather than overflowing: one control per line below lg, as many as fit beside each
          other above that, and the original single row once the window is wide enough. */}
      <div className={`${optionsOpen ? "flex" : "hidden"} flex-col gap-5 border-b border-border pt-4 pb-5 lg:flex lg:flex-row lg:flex-wrap lg:items-end lg:gap-x-6 lg:gap-y-4 lg:rounded-md lg:border lg:px-5 lg:py-4 xl:flex-nowrap xl:items-center`}>
        <div className="w-full xl:w-[200px] xl:shrink-0">
          <div className="hidden text-row font-semibold lg:block">Apply to this batch</div>
          <div className="text-body text-muted lg:text-small">Files with a category skip the Inbox.</div>
        </div>
        <div className="w-full lg:w-[260px] lg:shrink-0">
          <ItemPicker items={items} selected={defaults.itemIds} onChange={(ids) => setDefaults((d) => ({ ...d, itemIds: ids }))} />
        </div>
        <label className="flex w-full flex-col gap-1.5 lg:w-auto">
          <span className="text-body font-semibold lg:hidden">File to</span>
          <span className="label hidden lg:block">File to</span>
          <select
            value={defaults.categoryId}
            onChange={(e) => setDefaults((d) => ({ ...d, categoryId: e.target.value }))}
            className={`h-11 w-full rounded-md border border-border bg-ground px-3 text-body lg:h-9 lg:w-[220px] lg:text-row ${defaults.categoryId ? "" : "text-muted"}`}
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
        <label className="flex w-full flex-col gap-1.5 lg:w-auto">
          <span className="text-body font-semibold lg:hidden">Tags</span>
          <span className="label hidden lg:block">Tags</span>
          <input
            value={defaults.tags}
            onChange={(e) => setDefaults((d) => ({ ...d, tags: e.target.value }))}
            placeholder="+ Tag, another"
            className="h-11 w-full rounded-md border border-dashed border-border-strong bg-ground px-3 text-body placeholder:text-muted lg:h-9 lg:w-[200px] lg:text-row"
          />
        </label>
      </div>
      </div>

      {queue.length > 0 && (
        <section className="mt-7 flex flex-col gap-3 lg:mt-0 lg:gap-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 lg:gap-y-2">
            <div className="flex flex-col gap-0.5 lg:flex-row lg:flex-wrap lg:items-baseline lg:gap-x-2.5 lg:gap-y-1">
              <h2 className="text-copy font-semibold lg:text-section lg:tracking-snug">Uploading</h2>
              <span className="text-body text-muted lg:text-small">
                {done} of {queue.length} done
                {active ? ` · ${active} in progress` : ""}
                {decisions ? ` · ${decisions} need${decisions === 1 ? "s" : ""} a decision` : ""}
                {waiting ? ` · ${waiting} waiting` : ""}
                {failed ? ` · ${failed} failed` : ""}
              </span>
            </div>
            <div className="flex gap-5">
              {(waiting > 0 || active > 0) && (
                <button type="button" onClick={() => setPaused((p) => !p)} className="min-h-11 text-body font-medium text-accent lg:min-h-0 lg:text-row">
                  {paused ? "Resume" : "Pause"}
                </button>
              )}
              {(waiting > 0 || active > 0) && (
                <button type="button" onClick={cancelRemaining} className="min-h-11 text-body font-medium text-muted lg:min-h-0 lg:text-row">
                  Cancel remaining
                </button>
              )}
            </div>
          </div>
          <div className="h-1 overflow-hidden rounded-pill bg-surface">
            <div className="h-1 rounded-pill bg-accent transition-[width]" style={{ width: `${Math.round((done / queue.length) * 100)}%` }} />
          </div>
          {/* Each file its own tinted card on a phone, as in the design; the hairline list above. */}
          <ul className="flex flex-col gap-2 lg:gap-0 lg:border-b lg:border-border">
            {queue.map((it) => (
              <Row
                key={it.id}
                item={it}
                paused={paused}
                onDecide={(keep) => update(it.id, keep ? { phase: { kind: "waiting" }, versionOf: it.phase.kind === "duplicate" ? it.phase.of.documentId : undefined } : { phase: { kind: "skipped" } })}
                onRetry={() => update(it.id, { phase: { kind: "waiting" } })}
              />
            ))}
          </ul>
          <p className="mt-2 flex items-start gap-2.5 text-body text-muted lg:items-center lg:text-small">
            <LockIcon /> Encrypted the moment it lands on the appliance. Originals are never altered — the searchable copy is stored alongside.
          </p>
        </section>
      )}
    </div>
  );
}

function Row({ item, paused, onDecide, onRetry }: { item: QueueEntry; paused: boolean; onDecide: (keep: boolean) => void; onRetry: () => void }) {
  const { file, phase } = item;
  const actionable = phase.kind === "duplicate" || phase.kind === "failed" || phase.kind === "cancelled";
  return (
    // Name, progress and actions side by side where there is room; stacked beside the thumbnail
    // where there is not.
    <li className="flex items-start gap-3.5 rounded-lg bg-surface p-3.5 lg:min-h-16 lg:rounded-none lg:border-t lg:border-border lg:bg-transparent lg:px-0 lg:py-3 xl:h-16 xl:items-center xl:py-0">
      {phase.kind === "ready" || phase.kind === "processing" ? (
        <>
          <div className="lg:hidden">
            <DocThumb documentId={phase.doc.id} hasThumbnail={phase.doc.file.hasThumbnail} version={phase.doc.file.version} width={36} height={46} className="rounded-sm" />
          </div>
          <div className="hidden lg:block">
            <DocThumb documentId={phase.doc.id} hasThumbnail={phase.doc.file.hasThumbnail} version={phase.doc.file.version} width={30} height={38} className="rounded-sm" />
          </div>
        </>
      ) : (
        <div className="h-[46px] w-9 shrink-0 rounded-sm border border-border bg-ground lg:h-[38px] lg:w-[30px] lg:bg-surface" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2 xl:flex-row xl:items-center xl:gap-3.5">
      <div className="min-w-0 xl:w-[340px] xl:shrink-0">
        <div className="truncate text-copy font-semibold lg:text-row">{file.name}</div>
        <div className="text-body text-muted lg:text-small">
          {formatBytes(file.size)}
          {item.versionOf ? " · new version" : ""}
        </div>
      </div>
      <div className="min-w-0 flex-1 text-body lg:text-small">
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
      {/* The pill repeats the status line, so a phone shows only the buttons, at finger size. */}
      <div className={`${actionable ? "flex" : "hidden lg:flex"} shrink-0 flex-wrap items-center gap-2 lg:gap-3.5 xl:w-[196px] xl:flex-nowrap xl:justify-end`}>
        {phase.kind === "duplicate" ? (
          <>
            <button type="button" onClick={() => onDecide(true)} className="h-11 rounded-md border border-border bg-ground px-4 text-body font-medium lg:h-[30px] lg:px-3 lg:text-small">
              Add as new version
            </button>
            <button type="button" onClick={() => onDecide(false)} className="h-11 px-3 text-body font-medium text-muted lg:h-auto lg:px-0 lg:text-small">
              Skip
            </button>
          </>
        ) : phase.kind === "failed" || phase.kind === "cancelled" ? (
          <>
            <button type="button" onClick={onRetry} className="h-11 rounded-md border border-border bg-ground px-4 text-body font-medium lg:h-[30px] lg:px-3 lg:text-small">
              {phase.kind === "failed" ? "Try again" : "Resume"}
            </button>
            <Pill phase={phase} />
          </>
        ) : (
          <Pill phase={phase} />
        )}
      </div>
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
  return <span className={`hidden h-[22px] items-center rounded-pill px-2.5 text-label font-semibold lg:inline-flex ${tone}`}>{label}</span>;
}

function Bar({ fraction }: { fraction: number }) {
  return (
    // Full width on a phone, on a track that shows against the row's tint.
    <div className="h-1 w-full overflow-hidden rounded-pill bg-border lg:max-w-[260px] lg:bg-surface">
      <div className="h-1 rounded-pill bg-accent transition-[width]" style={{ width: `${Math.round(Math.min(1, fraction) * 100)}%` }} />
    </div>
  );
}

/** One way in on a phone: a 48px tile, a name and what it is for. Only the camera is filled. */
function PickRow({ onClick, title, hint, icon, filled = false }: { onClick: () => void; title: string; hint: string; icon: ReactNode; filled?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-16 items-center gap-4 border-b border-border py-3.5 text-left">
      <span className={`flex size-12 shrink-0 items-center justify-center rounded-lg ${filled ? "bg-accent-fill text-white" : "bg-accent-soft text-accent"}`}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {icon}
        </svg>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-copy font-semibold">{title}</span>
        <span className="text-body text-muted">{hint}</span>
      </span>
    </button>
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
