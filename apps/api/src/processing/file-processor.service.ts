import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UnrecoverableError } from "bullmq";
import { eq } from "drizzle-orm";
import { open, readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { documentFiles, documentText, documents, settings, type Db } from "@harbor/db";
import type { ProcessingStatus } from "@harbor/shared";
import { sniffKind, type FileKind } from "../common/sniff";
import type { Env } from "../config/env";
import { InjectDb } from "../db/db.module";
import { InjectSuggestQueue, type SuggestJob } from "../queue/queue.module";
import type { Queue } from "bullmq";
import { SearchIndexService } from "../search/search-index.service";
import { SETTING } from "../settings/settings.service";
import { BlobStore } from "../storage/blob-store.service";
import { ExecError, run } from "./exec";
import { parseScanResult, type ScanResult } from "./scan";
import { hasUsableTextLayer, pageFromOcrLine, pagesFromPdfInfo } from "./text-quality";

/** Hard ceiling per job; a 100-page scan on a fanless box fits comfortably (spec §2 stage 2). */
export const JOB_TIMEOUT_MS = 20 * 60 * 1000;

export interface ProcessContext {
  signal: AbortSignal;
  progress: (fraction: number) => Promise<void> | void;
}

export interface ProcessResult {
  engine: "pdftotext" | "ocrmypdf" | null;
  pageCount: number | null;
  chars: number;
  ms: number;
}

/**
 * Stages 1-3 of the pipeline (spec §2): normalise -> OCR only if needed -> index.
 * Runs inside the network-less worker container. The original blob is never modified;
 * the searchable PDF is a second blob encrypted under the same DEK with its own IV.
 */
@Injectable()
export class FileProcessor {
  private readonly log = new Logger(FileProcessor.name);
  private readonly ocrLanguages: string;
  private readonly scanPython: string;
  private readonly scanScript: string;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly blobs: BlobStore,
    @InjectSuggestQueue() private readonly suggestQueue: Queue<SuggestJob>,
    private readonly searchIndex: SearchIndexService,
    config: ConfigService<Env, true>,
  ) {
    this.ocrLanguages = config.get("OCR_LANGUAGES", { infer: true });
    this.scanPython = config.get("SCAN_CLEANUP_PYTHON", { infer: true });
    this.scanScript = config.get("SCAN_CLEANUP_SCRIPT", { infer: true });
  }

  async process(documentFileId: string, ctx: ProcessContext): Promise<ProcessResult> {
    const started = Date.now();
    const row = await this.db
      .select({ df: documentFiles, title: documents.title, notes: documents.notes })
      .from(documentFiles)
      .innerJoin(documents, eq(documents.id, documentFiles.documentId))
      .where(eq(documentFiles.id, documentFileId))
      .limit(1)
      .then((r) => r[0]);
    if (!row) throw new UnrecoverableError(`document_files ${documentFileId} does not exist`);
    const { df } = row;

    const work = path.join(this.blobs.tmpDir, `job-${df.id}`);
    await mkdir(work, { recursive: true, mode: 0o700 });
    try {
      await this.setStatus(df.id, "extracting");
      const dek = this.blobs.unwrapDek(df.dekWrapped, df.storageKey);
      const original = path.join(work, "original");
      await this.blobs.openToFile(df.storageKey, dek, df.iv, df.authTag, original);

      const kind = await sniffFile(original);
      let text = "";
      let engine: ProcessResult["engine"] = null;
      let pageCount: number | null = null;
      let searchable: { key: string; iv: Buffer; tag: Buffer } | null = null;
      let scan: ScanResult | null = null;

      if (kind === "unknown") {
        // Stored as-is, not searchable (spec §2 stage 1: office files etc. are out of scope for v1).
        this.log.log(`${df.id}: unsupported type, stored without text`);
      } else {
        let pdfIn = original;
        if (kind === "heic") {
          const jpg = path.join(work, "converted.jpg");
          await run("heif-convert", [original, jpg], { signal: ctx.signal });
          pdfIn = jpg;
        }
        if (kind !== "pdf" && (await this.photosToScans())) {
          scan = await this.toScan(df.id, pdfIn, path.join(work, "scan.jpg"), ctx.signal);
          if (scan) pdfIn = path.join(work, "scan.jpg");
        }
        if (kind === "pdf") {
          pageCount = pagesFromPdfInfo((await run("pdfinfo", [pdfIn], { signal: ctx.signal })).stdout);
          const layer = (await run("pdftotext", ["-layout", pdfIn, "-"], { signal: ctx.signal })).stdout;
          if (hasUsableTextLayer(layer, pageCount ?? 1)) {
            text = layer;
            engine = "pdftotext";
          }
        }
        if (engine === null) {
          await this.setStatus(df.id, "ocr", 0);
          const out = path.join(work, "searchable.pdf");
          const total = pageCount ?? 1;
          // --rotate-pages only acts above a confidence ocrmypdf defaults to 14. Tesseract's
          // orientation detector reported a real upside-down scan at 2.8 and 7.6, and correctly
          // oriented pages at 5.9 and 13.9, so the default never rotates anything. A page the
          // detector calls "facing up" is never rotated whatever the threshold, so the only risk
          // of going low is a page it misreads as rotated with confidence above 2: measured
          // 2026-09-10 on desk-scanner output, not seen.
          const args = ["--skip-text", "--rotate-pages", "--rotate-pages-threshold", "2", "--optimize", "1", "-l", this.ocrLanguages, "--jobs", "1", "-v", "1"];
          // A scan is already square to the page's own edges, which beats a guess from its text
          // lines: on a folded letter showing its back through the paper, --deskew turned a
          // straight scan 3° askew.
          if (!scan) args.push("--deskew");
          if (kind !== "pdf") args.push("--image-dpi", String(scan?.dpi ?? 300));
          args.push(pdfIn, out);
          let lastPage = 0;
          await run("ocrmypdf", args, {
            signal: ctx.signal,
            onStderrLine: (line) => {
              const p = pageFromOcrLine(line);
              if (p && p > lastPage) {
                lastPage = p;
                void this.setStatus(df.id, "ocr", Math.min(p / total, 0.99));
                void ctx.progress(p / total);
              }
            },
          });
          pageCount = pagesFromPdfInfo((await run("pdfinfo", [out], { signal: ctx.signal })).stdout) ?? pageCount;
          text = (await run("pdftotext", ["-layout", out, "-"], { signal: ctx.signal })).stdout;
          engine = "ocrmypdf";
          const sealed = await this.blobs.sealFile(out, dek);
          searchable = { key: sealed.storageKey, iv: sealed.iv, tag: sealed.authTag };
        }
      }
      // First-page preview (spec §4: real thumbnails on every card). Best-effort; never fails the job.
      let thumb: { key: string; iv: Buffer; tag: Buffer } | null = null;
      const thumbSource = searchable ? path.join(work, "searchable.pdf") : kind === "pdf" ? original : null;
      if (thumbSource) {
        try {
          await run("pdftoppm", ["-f", "1", "-l", "1", "-scale-to", "480", "-png", "-singlefile", thumbSource, path.join(work, "thumb")], { signal: ctx.signal });
          const sealedThumb = await this.blobs.sealFile(path.join(work, "thumb.png"), dek);
          thumb = { key: sealedThumb.storageKey, iv: sealedThumb.iv, tag: sealedThumb.authTag };
        } catch (err) {
          this.log.warn(`${df.id}: no thumbnail: ${(err as Error).message.slice(0, 120)}`);
        }
      }
      dek.fill(0);

      await this.setStatus(df.id, "indexing");
      const ms = Date.now() - started;
      await this.db.transaction(async (tx) => {
        await tx
          .insert(documentText)
          .values({
            documentFileId: df.id,
            textContent: text,
            ocrEngine: engine,
            ocrMs: ms,
            searchablePdfKey: searchable?.key ?? null,
            searchablePdfIv: searchable?.iv ?? null,
            searchablePdfTag: searchable?.tag ?? null,
          })
          .onConflictDoUpdate({
            target: documentText.documentFileId,
            set: {
              textContent: text,
              ocrEngine: engine,
              ocrMs: ms,
              searchablePdfKey: searchable?.key ?? null,
              searchablePdfIv: searchable?.iv ?? null,
              searchablePdfTag: searchable?.tag ?? null,
              completedAt: new Date(),
            },
          });
        // One place decides what goes into the vector and at which weight. This ran its own copy
        // of that SQL until the two drifted apart twice in a row.
        await this.searchIndex.reindex([df.documentId], tx);
        await tx
          .update(documentFiles)
          .set({
            processingStatus: text ? "suggesting" : "ready",
            processingError: null,
            pageProgress: null,
            pageCount,
            scanOutline: scan?.outline ?? null,
            ...(thumb ? { thumbnailKey: thumb.key, thumbnailIv: thumb.iv, thumbnailTag: thumb.tag } : {}),
          })
          .where(eq(documentFiles.id, df.id));
      });
      // Stage 4 runs in the suggester container (the only one with a route out). Best-effort: it flips to ready either way.
      // No fixed jobId: BullMQ would dedupe against the previous completed job and silently skip
      // re-suggesting on reprocess. Repeat runs are idempotent via the unique index on suggestions.
      if (text) await this.suggestQueue.add("suggest", { documentFileId: df.id });

      this.log.log(`${df.id}: ${engine ?? "no-text"} · ${pageCount ?? "?"} pages · ${text.length} chars · ${ms} ms`);
      return { engine, pageCount, chars: text.length, ms };
    } catch (err) {
      const message = describe(err);
      await this.setStatus(df.id, "failed", null, message);
      // Tool failures are deterministic: retrying the same bytes gives the same result.
      if (err instanceof ExecError || ctx.signal.aborted) throw new UnrecoverableError(message);
      throw err;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /**
   * Turns a phone photo into a scan before OCR (spec §2 stage 1b): flattened, cropped to the page,
   * folds straightened, shadows and colour cast removed. The scan becomes the searchable PDF; the
   * original upload is untouched. Best-effort: a photo the script leaves alone, or any failure of
   * the script itself, is OCR'd as it was taken.
   */
  private async toScan(id: string, photo: string, out: string, signal: AbortSignal): Promise<ScanResult | null> {
    try {
      const { stdout } = await run(this.scanPython, [this.scanScript, photo, out], { signal });
      const scan = parseScanResult(stdout);
      this.log.log(`${id}: ${scan ? `scan · ${scan.outline} outline · ${scan.folds} folds · ${scan.dpi} dpi` : "photo left as taken"}`);
      return scan;
    } catch (err) {
      // A timeout is the job's, not the step's: let it fail the job as it would anywhere else.
      if (signal.aborted) throw err;
      this.log.warn(`${id}: no scan, photo OCR'd as taken: ${(err as Error).message.slice(0, 200)}`);
      return null;
    }
  }

  /**
   * Settings → Documents. Read here rather than through SettingsService, which the worker does
   * not load: this is one plain key, and reading it per job means a change applies to the next
   * upload without restarting anything.
   */
  private async photosToScans(): Promise<boolean> {
    const [row] = await this.db.select({ value: settings.value }).from(settings).where(eq(settings.key, SETTING.photosToScans));
    return row?.value !== "false";
  }

  private async setStatus(id: string, status: ProcessingStatus, progress: number | null = null, error: string | null = null) {
    await this.db
      .update(documentFiles)
      .set({ processingStatus: status, pageProgress: progress, processingError: error })
      .where(eq(documentFiles.id, id));
  }
}

async function sniffFile(file: string): Promise<FileKind> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    return sniffKind(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

function describe(err: unknown): string {
  if (err instanceof ExecError) return err.message.slice(0, 1000);
  if (err instanceof Error) return (err.name === "AbortError" ? "Timed out" : err.message).slice(0, 1000);
  return String(err).slice(0, 1000);
}

export { readFile };
