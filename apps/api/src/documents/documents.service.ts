import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { Queue } from "bullmq";
import { open, rm } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { auditLog, categories, documentFiles, documentItems, documentText, documentViews, documents, items, users, type Db } from "@harbor/db";
import { titleFromFilename } from "@harbor/shared";
import type { AcceptAllResult, AcceptSuggestion, ActivityEntry, DeletedDocument, DocumentSummary, DocumentText, DocumentVersion, RecentDocument, SuggestionView, UpdateDocument, UploadFields, UploadResult } from "@harbor/shared";
import { AuditService } from "../audit/audit.service";
import { SearchIndexService } from "../search/search-index.service";
import { MIME_BY_KIND, sniffKind } from "../common/sniff";
import { CryptoService } from "../crypto/crypto.service";
import { InjectDb } from "../db/db.module";
import { InjectProcessFileQueue, type ProcessFileJob } from "../queue/queue.module";
import { BlobStore } from "../storage/blob-store.service";
import { SuggestService } from "../suggest/suggest.service";
import { CategoriesService } from "../vocabulary/categories.service";
import { TagsService } from "../vocabulary/tags.service";

/** Who the document belongs to and how it got here. `source` is stored on `documents` (spec §1). */
export interface IngestContext {
  userId: string;
  ip?: string | null;
  source?: "upload" | "email";
  /** Who emailed it. Stored on the document so it survives the ingest log being pruned (§7). */
  mailFrom?: string | null;
}

export interface IncomingFile {
  /** Path of the plaintext temp file written by the upload middleware. Deleted by this service. */
  path: string;
  originalName: string;
  byteSize: number;
}

type DocRow = typeof documents.$inferSelect;
type FileRow = typeof documentFiles.$inferSelect;

/** How far back "Recent" goes. Longer than the sidebar shows, so scrolling has somewhere to go. */
export const RECENT_LIMIT = 20;

@Injectable()
export class DocumentsService {
  private readonly log = new Logger(DocumentsService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly blobs: BlobStore,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly suggest: SuggestService,
    private readonly categoriesService: CategoriesService,
    private readonly tagsService: TagsService,
    private readonly searchIndex: SearchIndexService,
    @InjectProcessFileQueue() private readonly queue: Queue<ProcessFileJob>,
  ) {}

  // ---------- intake (spec §2 stage 0) ----------

  /**
   * Stage 0 for every path into the vault (spec §2): the web upload and, since §7, an attachment
   * pulled off a mailbox. Both get identical treatment — same duplicate check, same per-file DEK,
   * same queue, same Inbox card — because "the original bytes are sacred" cannot depend on how
   * the bytes arrived. `source` is the only thing that differs, and it is only ever a label.
   */
  async ingest(file: IncomingFile, fields: UploadFields, opts: IngestContext): Promise<UploadResult> {
    const { userId, ip = null, source = "upload", mailFrom = null } = opts;
    try {
      const [sha256, head] = await Promise.all([this.blobs.sha256(file.path), readHead(file.path)]);
      const kind = sniffKind(head);
      const duplicateOf = await this.findDuplicate(sha256);
      if (fields.categoryId) {
        const exists = await this.db.query.categories.findFirst({ where: eq(categories.id, fields.categoryId) });
        if (!exists) throw new BadRequestException("Unknown category");
      }
      /** "Add as new version": the file joins the existing document instead of creating one (spec §1). */
      const versionOf = fields.versionOf ? await this.loadRow(fields.versionOf) : null;

      const dek = this.crypto.generateDek();
      const sealed = await this.blobs.sealFile(file.path, dek);
      const dekWrapped = this.blobs.wrapDek(dek, sealed.storageKey);
      dek.fill(0);

      const title = titleFromFilename(file.originalName);
      const created = await this.db.transaction(async (tx) => {
        let doc: DocRow;
        let version = 1;
        if (versionOf) {
          doc = versionOf.doc;
          version = versionOf.df.version + 1;
          await tx.update(documentFiles).set({ isCurrent: false }).where(eq(documentFiles.documentId, doc.id));
          await tx.update(documents).set({ updatedAt: new Date() }).where(eq(documents.id, doc.id));
        } else {
          const [inserted] = await tx
            .insert(documents)
            .values({ title, source, mailFrom, createdBy: userId, categoryId: fields.categoryId ?? null })
            .returning();
          doc = inserted!;
          if (fields.itemIds.length) await tx.insert(documentItems).values(fields.itemIds.map((itemId: string) => ({ documentId: doc.id, itemId })));
          if (fields.tags.length) await this.tagsService.setForDocument(doc.id, fields.tags, tx);
        }
        const [df] = await tx
          .insert(documentFiles)
          .values({
            documentId: doc.id,
            version,
            storageKey: sealed.storageKey,
            sha256,
            originalFilename: file.originalName.slice(0, 255),
            mimeType: MIME_BY_KIND[kind],
            byteSize: sealed.byteSize,
            dekWrapped,
            iv: sealed.iv,
            authTag: sealed.authTag,
            uploadedBy: userId,
          })
          .returning();
        return { doc, df: df! };
      });

      await this.queue.add("process", { documentFileId: created.df.id }, { jobId: created.df.id });
      await this.audit.record({
        action: versionOf ? "document.new_version" : source === "email" ? "document.email_in" : "document.upload",
        actorUserId: userId,
        entityType: "document",
        entityId: created.doc.id,
        metadata: { filename: file.originalName, bytes: sealed.byteSize, kind, version: created.df.version, filedTo: fields.categoryId ?? null, duplicateOf: duplicateOf?.documentId ?? null },
        ip,
      });

      const [summary] = await this.assemble([{ doc: created.doc, df: created.df }]);
      return { document: summary!, duplicateOf };
    } finally {
      await rm(file.path, { force: true });
    }
  }

  async findDuplicate(sha256: string): Promise<UploadResult["duplicateOf"]> {
    const row = await this.db
      .select({ documentId: documents.id, title: documents.title, addedAt: documents.createdAt })
      .from(documentFiles)
      .innerJoin(documents, eq(documents.id, documentFiles.documentId))
      .where(and(eq(documentFiles.sha256, sha256), eq(documentFiles.isCurrent, true), isNull(documents.deletedAt)))
      .orderBy(desc(documents.createdAt))
      .limit(1)
      .then((r) => r[0]);
    return row ? { ...row, addedAt: row.addedAt.toISOString() } : null;
  }

  // ---------- reads ----------

  async list(opts: { inboxOnly?: boolean; itemIds?: string[]; categoryId?: string; source?: "upload" | "email"; sort?: "newest" | "oldest" | "title" | "date" | "expires"; limit?: number } = {}): Promise<DocumentSummary[]> {
    const conditions: SQL[] = [isNull(documents.deletedAt)];
    if (opts.inboxOnly) conditions.push(isNull(documents.categoryId));
    if (opts.itemIds?.length)
      conditions.push(sql`exists (select 1 from ${documentItems} di where di.document_id = ${documents.id} and di.item_id in ${opts.itemIds})`);
    if (opts.source) conditions.push(eq(documents.source, opts.source));
    if (opts.categoryId) {
      // A top-level category includes its children (spec §1: depth <= 2).
      const cats = await this.categoriesService.index();
      const ids = [...cats.values()].filter((c) => c.cat.id === opts.categoryId || c.cat.parentId === opts.categoryId).map((c) => c.cat.id);
      conditions.push(ids.length ? inArray(documents.categoryId, ids) : sql`false`);
    }
    const order = opts.inboxOnly
      ? [desc(documents.updatedAt)] // a new version or edit surfaces the card (Kai's report 2026-09-07)
      : opts.sort === "oldest"
        ? [asc(documents.createdAt)]
        : opts.sort === "title"
          ? [asc(documents.title)]
          : opts.sort === "date"
            ? [sql`${documents.documentDate} desc nulls last`, desc(documents.createdAt)]
            : opts.sort === "expires"
              ? [sql`${documents.expiresAt} asc nulls last`, desc(documents.createdAt)]
              : [desc(documents.createdAt)];
    const rows = await this.db
      .select({ doc: documents, df: documentFiles })
      .from(documents)
      .innerJoin(documentFiles, and(eq(documentFiles.documentId, documents.id), eq(documentFiles.isCurrent, true)))
      .where(and(...conditions))
      .orderBy(...order)
      .limit(opts.limit ?? 200);
    return this.assemble(rows);
  }

  /**
   * Records that someone opened a document, so it can be offered back to them. Upsert, not append:
   * one row per (user, document), reopening only moves the timestamp. Failures are swallowed —
   * nobody should be unable to read a document because we could not write down that they did.
   */
  async recordView(documentId: string, userId: string): Promise<void> {
    try {
      await this.db
        .insert(documentViews)
        .values({ documentId, userId })
        .onConflictDoUpdate({ target: [documentViews.userId, documentViews.documentId], set: { viewedAt: new Date() } });
    } catch (err) {
      this.log.warn(`could not record view of ${documentId}: ${(err as Error).message}`);
    }
  }

  /** Most recently opened first. Deleted documents drop out on their own via the join. */
  async recent(userId: string, limit = RECENT_LIMIT): Promise<RecentDocument[]> {
    const rows = await this.db
      .select({
        documentId: documents.id,
        title: documents.title,
        categoryId: documents.categoryId,
        viewedAt: documentViews.viewedAt,
        thumbnailKey: documentFiles.thumbnailKey,
        version: documentFiles.version,
      })
      .from(documentViews)
      .innerJoin(documents, and(eq(documents.id, documentViews.documentId), isNull(documents.deletedAt)))
      .innerJoin(documentFiles, and(eq(documentFiles.documentId, documents.id), eq(documentFiles.isCurrent, true)))
      .where(eq(documentViews.userId, userId))
      .orderBy(desc(documentViews.viewedAt))
      .limit(limit);
    const cats = await this.categoriesService.index();
    return rows.map((r) => ({
      documentId: r.documentId,
      title: r.title,
      categoryPath: r.categoryId ? (cats.get(r.categoryId)?.path ?? null) : null,
      viewedAt: r.viewedAt.toISOString(),
      hasThumbnail: r.thumbnailKey !== null,
      version: r.version,
    }));
  }

  async get(documentId: string): Promise<DocumentSummary> {
    const row = await this.loadRow(documentId);
    const [summary] = await this.assemble([row]);
    return summary!;
  }

  /** Decrypted first-page PNG. Not audited: previews render on every list and would drown the log. */
  async openThumbnail(documentId: string): Promise<{ stream: Readable; fileId: string } | null> {
    const { df } = await this.loadRow(documentId);
    if (!df.thumbnailKey || !df.thumbnailIv || !df.thumbnailTag) return null;
    const dek = this.blobs.unwrapDek(df.dekWrapped, df.storageKey);
    const stream = this.blobs.openStream(df.thumbnailKey, dek, df.thumbnailIv, df.thumbnailTag);
    dek.fill(0);
    return { stream, fileId: df.id };
  }

  /** Re-run the pipeline on the current file: "Try again" on a failed card, or backfilling previews. */
  async reprocess(documentId: string, userId: string, ip: string | null): Promise<DocumentSummary> {
    const { df } = await this.loadRow(documentId);
    await this.db.update(documentFiles).set({ processingStatus: "queued", processingError: null, pageProgress: null }).where(eq(documentFiles.id, df.id));
    await this.queue.add("process", { documentFileId: df.id }, { jobId: `${df.id}-${Date.now()}` });
    await this.audit.record({ action: "document.reprocess", actorUserId: userId, entityType: "document", entityId: documentId, ip });
    return this.get(documentId);
  }

  async versions(documentId: string): Promise<DocumentVersion[]> {
    await this.loadRow(documentId);
    const rows = await this.db
      .select({ df: documentFiles, uploader: users.displayName })
      .from(documentFiles)
      .leftJoin(users, eq(users.id, documentFiles.uploadedBy))
      .where(eq(documentFiles.documentId, documentId))
      .orderBy(desc(documentFiles.version));
    return rows.map(({ df, uploader }) => ({
      fileId: df.id,
      version: df.version,
      isCurrent: df.isCurrent,
      originalFilename: df.originalFilename,
      mimeType: df.mimeType,
      byteSize: df.byteSize,
      pageCount: df.pageCount,
      processingStatus: df.processingStatus,
      createdAt: df.createdAt.toISOString(),
      uploadedBy: uploader,
    }));
  }

  async text(documentId: string): Promise<DocumentText> {
    const { df } = await this.loadRow(documentId);
    const row = await this.db.query.documentText.findFirst({ where: eq(documentText.documentFileId, df.id) });
    return { fileId: df.id, engine: row?.ocrEngine ?? null, chars: row?.textContent.length ?? 0, text: row?.textContent ?? "" };
  }

  async activity(documentId: string): Promise<ActivityEntry[]> {
    await this.loadRowIncludingDeleted(documentId);
    const rows = await this.db
      .select({ log: auditLog, actor: users.displayName })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(and(eq(auditLog.entityType, "document"), eq(auditLog.entityId, documentId)))
      .orderBy(desc(auditLog.id))
      .limit(100);
    return rows.map(({ log, actor }) => ({ id: log.id, action: log.action, actor, metadata: log.metadata, createdAt: log.createdAt.toISOString() }));
  }

  /** Soft delete (spec §1 `deleted_at`). Blobs stay until a later purge; restore is one click. */
  async softDelete(documentId: string, userId: string, ip: string | null): Promise<void> {
    await this.loadRow(documentId);
    await this.db.update(documents).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, documentId));
    await this.audit.record({ action: "document.delete", actorUserId: userId, entityType: "document", entityId: documentId, ip });
  }

  /**
   * Soft-delete a batch. The Inbox's answer to a backfill that filed more than you wanted: clearing
   * forty receipts one confirmation at a time is not a thing anyone does, so they would stay.
   *
   * Soft, like the single-document delete — Recently deleted holds them, and a bulk judgement made
   * in one click needs to be undoable in one click.
   */
  async bulkSoftDelete(ids: string[], userId: string, ip: string | null): Promise<{ deleted: number }> {
    if (!ids.length) return { deleted: 0 };
    const rows = await this.db
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(and(inArray(documents.id, ids), isNull(documents.deletedAt)))
      .returning({ id: documents.id });
    await this.audit.record({
      action: "document.bulk_delete",
      actorUserId: userId,
      entityType: "document",
      metadata: { count: rows.length, ids: rows.slice(0, 50).map((r) => r.id) },
      ip,
    });
    return { deleted: rows.length };
  }

  async restore(documentId: string, userId: string, ip: string | null): Promise<DocumentSummary> {
    const row = await this.loadRowIncludingDeleted(documentId);
    if (!row.doc.deletedAt) return this.get(documentId);
    await this.db.update(documents).set({ deletedAt: null, updatedAt: new Date() }).where(eq(documents.id, documentId));
    await this.audit.record({ action: "document.restore", actorUserId: userId, entityType: "document", entityId: documentId, ip });
    return this.get(documentId);
  }

  async listDeleted(): Promise<DeletedDocument[]> {
    const cats = await this.categoriesService.index();
    const rows = await this.db
      .select({ doc: documents, df: documentFiles })
      .from(documents)
      .innerJoin(documentFiles, and(eq(documentFiles.documentId, documents.id), eq(documentFiles.isCurrent, true)))
      .where(sql`${documents.deletedAt} is not null`)
      .orderBy(desc(documents.deletedAt))
      .limit(200);
    return rows.map(({ doc, df }) => ({
      id: doc.id,
      title: doc.title,
      categoryPath: doc.categoryId ? (cats.get(doc.categoryId)?.path ?? null) : null,
      deletedAt: doc.deletedAt!.toISOString(),
      originalFilename: df.originalFilename,
    }));
  }

  /** Decrypted original, streamed. Audited: downloads of family paperwork are worth a row each. */
  async openOriginal(documentId: string, userId: string, ip: string | null, version?: number): Promise<{ stream: Readable; filename: string; mimeType: string; byteSize: number }> {
    const current = await this.loadRow(documentId);
    const df =
      version === undefined || version === current.df.version
        ? current.df
        : await this.db.query.documentFiles.findFirst({ where: and(eq(documentFiles.documentId, documentId), eq(documentFiles.version, version)) });
    if (!df) throw new NotFoundException("Version not found");
    const dek = this.blobs.unwrapDek(df.dekWrapped, df.storageKey);
    const stream = this.blobs.openStream(df.storageKey, dek, df.iv, df.authTag);
    dek.fill(0);
    await this.audit.record({ action: "document.download", actorUserId: userId, entityType: "document", entityId: documentId, metadata: { version: df.version }, ip });
    return { stream, filename: df.originalFilename, mimeType: df.mimeType, byteSize: df.byteSize };
  }

  // ---------- filing ----------

  async update(documentId: string, patch: UpdateDocument, userId: string, ip: string | null): Promise<DocumentSummary> {
    await this.loadRow(documentId);
    if (patch.categoryId) {
      const exists = await this.db.query.categories.findFirst({ where: eq(categories.id, patch.categoryId) });
      if (!exists) throw new BadRequestException("Unknown category");
    }
    await this.db.transaction(async (tx) => {
      const set: Partial<DocRow> = { updatedAt: new Date() };
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.categoryId !== undefined) set.categoryId = patch.categoryId;
      if (patch.documentDate !== undefined) set.documentDate = patch.documentDate;
      if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt;
      if (patch.notes !== undefined) set.notes = patch.notes;
      await tx.update(documents).set(set).where(eq(documents.id, documentId));
      if (patch.itemIds !== undefined) {
        await tx.delete(documentItems).where(eq(documentItems.documentId, documentId));
        if (patch.itemIds.length) await tx.insert(documentItems).values(patch.itemIds.map((itemId: string) => ({ documentId, itemId })));
      }
      if (patch.tags !== undefined) await this.tagsService.setForDocument(documentId, patch.tags, tx);
      // Title is weight A; items, tags, notes and the category path are weight B. All of them are
      // stale in the index until the file is reprocessed otherwise, so a retitled or refiled
      // document — or one whose note says what the scan doesn't — would not be found.
      if (
        patch.title !== undefined ||
        patch.itemIds !== undefined ||
        patch.tags !== undefined ||
        patch.notes !== undefined ||
        patch.categoryId !== undefined
      ) {
        await this.searchIndex.reindex([documentId], tx);
      }
    });
    await this.audit.record({ action: "document.update", actorUserId: userId, entityType: "document", entityId: documentId, metadata: { fields: Object.keys(patch) }, ip });
    return this.get(documentId);
  }

  /**
   * Copy the suggestion's fields onto the document and stamp it accepted (spec §5).
   * `override` carries what the card actually shows, so accepting always files the document —
   * a suggestion whose category could not be resolved must never leave it stuck in the Inbox.
   */
  async acceptSuggestion(documentId: string, userId: string, ip: string | null, override: AcceptSuggestion = {}): Promise<DocumentSummary> {
    const row = await this.loadRow(documentId);
    const s = (await this.suggest.latestForFiles([row.df.id])).get(row.df.id);
    if (!s) throw new NotFoundException("No suggestion to accept");
    const categoryId = override.categoryId ?? s.resolved.categoryId ?? undefined;
    if (!categoryId) throw new BadRequestException("Choose a category — this suggestion doesn't name one that exists in your vault.");
    const patch: UpdateDocument = {
      title: s.payload.title.trim() || undefined,
      categoryId,
      itemIds: override.itemIds ?? s.resolved.itemIds,
      documentDate: isoDate(s.payload.documentDate),
      expiresAt: isoDate(s.payload.expiresAt),
    };
    const updated = await this.update(documentId, patch, userId, ip);
    await this.suggest.markAccepted(s.id);
    await this.audit.record({ action: "document.suggestion_accept", actorUserId: userId, entityType: "document", entityId: documentId, metadata: { suggestionId: s.id, confidence: s.payload.confidence }, ip });
    return this.get(documentId);
  }

  async rejectSuggestion(documentId: string, userId: string, ip: string | null): Promise<DocumentSummary> {
    const row = await this.loadRow(documentId);
    const s = (await this.suggest.latestForFiles([row.df.id])).get(row.df.id);
    if (!s) throw new NotFoundException("No suggestion to reject");
    await this.suggest.markRejected(s.id);
    await this.audit.record({ action: "document.suggestion_reject", actorUserId: userId, entityType: "document", entityId: documentId, metadata: { suggestionId: s.id }, ip });
    return this.get(documentId);
  }

  /**
   * "Accept all suggestions": everything unresolved that names a category the vault has and is
   * not low-confidence. Low-confidence cards and ones with no usable category stay for a human.
   * Every filing is audited and reversible.
   */
  async acceptAll(userId: string, ip: string | null): Promise<AcceptAllResult> {
    const inbox = await this.list({ inboxOnly: true, limit: 500 });
    let accepted = 0;
    let skipped = 0;
    for (const d of inbox) {
      const s = d.suggestion;
      if (s && !s.acceptedAt && !s.rejectedAt && s.payload.confidence !== "low" && s.resolved.categoryId) {
        await this.acceptSuggestion(d.id, userId, ip);
        accepted++;
      } else skipped++;
    }
    await this.audit.record({ action: "document.accept_all", actorUserId: userId, metadata: { accepted, skipped }, ip });
    return { accepted, skipped };
  }

  // ---------- helpers ----------

  private async loadRowIncludingDeleted(documentId: string): Promise<{ doc: DocRow; df: FileRow }> {
    const row = await this.db
      .select({ doc: documents, df: documentFiles })
      .from(documents)
      .innerJoin(documentFiles, and(eq(documentFiles.documentId, documents.id), eq(documentFiles.isCurrent, true)))
      .where(eq(documents.id, documentId))
      .limit(1)
      .then((r) => r[0]);
    if (!row) throw new NotFoundException("Document not found");
    return row;
  }

  private async loadRow(documentId: string): Promise<{ doc: DocRow; df: FileRow }> {
    const row = await this.db
      .select({ doc: documents, df: documentFiles })
      .from(documents)
      .innerJoin(documentFiles, and(eq(documentFiles.documentId, documents.id), eq(documentFiles.isCurrent, true)))
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1)
      .then((r) => r[0]);
    if (!row) throw new NotFoundException("Document not found");
    return row;
  }

  /** Attach category path, people and the latest suggestion with three batched queries. */
  private async assemble(rows: { doc: DocRow; df: FileRow }[]): Promise<DocumentSummary[]> {
    if (rows.length === 0) return [];
    const docIds = rows.map((r) => r.doc.id);
    const [cats, links, sugg, tagNames] = await Promise.all([
      this.categoriesService.index(),
      this.db
        .select({ documentId: documentItems.documentId, id: items.id, kind: items.kind, label: items.label })
        .from(documentItems)
        .innerJoin(items, eq(items.id, documentItems.itemId))
        .where(inArray(documentItems.documentId, docIds)),
      this.suggest.latestForFiles(rows.map((r) => r.df.id)),
      this.tagsService.namesForDocuments(docIds),
    ]);
    const itemsByDoc = new Map<string, { id: string; kind: string; label: string }[]>();
    for (const l of links) itemsByDoc.set(l.documentId, [...(itemsByDoc.get(l.documentId) ?? []), { id: l.id, kind: l.kind, label: l.label }]);
    return rows.map(({ doc, df }) => {
      const cat = doc.categoryId ? cats.get(doc.categoryId) : undefined;
      return toSummary(doc, df, cat ? { id: cat.cat.id, name: cat.cat.name, path: cat.path } : null, itemsByDoc.get(doc.id) ?? [], tagNames.get(doc.id) ?? [], sugg.get(df.id) ?? null);
    });
  }
}

export function toSummary(
  doc: DocRow,
  df: FileRow,
  category: DocumentSummary["category"],
  linkedItems: DocumentSummary["items"],
  tagNames: string[],
  suggestion: SuggestionView | null,
): DocumentSummary {
  return {
    id: doc.id,
    title: doc.title,
    source: doc.source,
    mailFrom: doc.mailFrom,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    documentDate: doc.documentDate,
    expiresAt: doc.expiresAt,
    notes: doc.notes,
    category,
    items: linkedItems,
    tags: tagNames,
    suggestion,
    file: {
      id: df.id,
      version: df.version,
      originalFilename: df.originalFilename,
      mimeType: df.mimeType,
      byteSize: df.byteSize,
      pageCount: df.pageCount,
      processingStatus: df.processingStatus,
      processingError: df.processingError,
      pageProgress: df.pageProgress,
      hasThumbnail: df.thumbnailKey !== null,
    },
  };
}



function isoDate(v: string | null): string | null | undefined {
  if (!v) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

async function readHead(file: string, bytes = 16): Promise<Buffer> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}
