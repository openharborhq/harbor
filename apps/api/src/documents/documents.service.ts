import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Queue } from "bullmq";
import { open, rm } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { auditLog, categories, documentFiles, documentPeople, documentText, documents, people, users, type Db } from "@trustworthier/db";
import type { AcceptAllResult, ActivityEntry, DeletedDocument, DocumentSummary, DocumentText, DocumentVersion, SuggestionView, UpdateDocument, UploadFields, UploadResult } from "@trustworthier/shared";
import { AuditService } from "../audit/audit.service";
import { MIME_BY_KIND, sniffKind } from "../common/sniff";
import { CryptoService } from "../crypto/crypto.service";
import { InjectDb } from "../db/db.module";
import { InjectProcessFileQueue, type ProcessFileJob } from "../queue/queue.module";
import { BlobStore } from "../storage/blob-store.service";
import { SuggestService } from "../suggest/suggest.service";
import { CategoriesService } from "../vocabulary/categories.service";
import { TagsService } from "../vocabulary/tags.service";

export interface IncomingFile {
  /** Path of the plaintext temp file written by the upload middleware. Deleted by this service. */
  path: string;
  originalName: string;
  byteSize: number;
}

type DocRow = typeof documents.$inferSelect;
type FileRow = typeof documentFiles.$inferSelect;

@Injectable()
export class DocumentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly blobs: BlobStore,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly suggest: SuggestService,
    private readonly categoriesService: CategoriesService,
    private readonly tagsService: TagsService,
    @InjectProcessFileQueue() private readonly queue: Queue<ProcessFileJob>,
  ) {}

  // ---------- intake (spec §2 stage 0) ----------

  async ingestUpload(file: IncomingFile, fields: UploadFields, userId: string, ip: string | null): Promise<UploadResult> {
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
            .values({ title, source: "upload", createdBy: userId, categoryId: fields.categoryId ?? null })
            .returning();
          doc = inserted!;
          if (fields.personIds.length) await tx.insert(documentPeople).values(fields.personIds.map((personId) => ({ documentId: doc.id, personId })));
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
        action: versionOf ? "document.new_version" : "document.upload",
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

  async list(opts: { inboxOnly?: boolean; limit?: number } = {}): Promise<DocumentSummary[]> {
    const rows = await this.db
      .select({ doc: documents, df: documentFiles })
      .from(documents)
      .innerJoin(documentFiles, and(eq(documentFiles.documentId, documents.id), eq(documentFiles.isCurrent, true)))
      .where(and(isNull(documents.deletedAt), opts.inboxOnly ? isNull(documents.categoryId) : sql`true`))
      .orderBy(desc(documents.createdAt))
      .limit(opts.limit ?? 100);
    return this.assemble(rows);
  }

  async get(documentId: string): Promise<DocumentSummary> {
    const row = await this.loadRow(documentId);
    const [summary] = await this.assemble([row]);
    return summary!;
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
      if (patch.personIds !== undefined) {
        await tx.delete(documentPeople).where(eq(documentPeople.documentId, documentId));
        if (patch.personIds.length) await tx.insert(documentPeople).values(patch.personIds.map((personId) => ({ documentId, personId })));
      }
      if (patch.tags !== undefined) await this.tagsService.setForDocument(documentId, patch.tags, tx);
    });
    await this.audit.record({ action: "document.update", actorUserId: userId, entityType: "document", entityId: documentId, metadata: { fields: Object.keys(patch) }, ip });
    return this.get(documentId);
  }

  /** Copy the suggestion's fields onto the document and stamp it accepted (spec §5). */
  async acceptSuggestion(documentId: string, userId: string, ip: string | null): Promise<DocumentSummary> {
    const row = await this.loadRow(documentId);
    const s = (await this.suggest.latestForFiles([row.df.id])).get(row.df.id);
    if (!s) throw new NotFoundException("No suggestion to accept");
    const patch: UpdateDocument = {
      title: s.payload.title.trim() || undefined,
      categoryId: s.resolved.categoryId ?? undefined,
      personIds: s.resolved.personIds,
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

  /** "Accept all suggestions": high-confidence, unresolved, with a category to file into. */
  async acceptAll(userId: string, ip: string | null): Promise<AcceptAllResult> {
    const inbox = await this.list({ inboxOnly: true, limit: 500 });
    let accepted = 0;
    let skipped = 0;
    for (const d of inbox) {
      const s = d.suggestion;
      if (s && !s.acceptedAt && !s.rejectedAt && s.payload.confidence === "high" && s.resolved.categoryId) {
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
        .select({ documentId: documentPeople.documentId, id: people.id, displayName: people.displayName })
        .from(documentPeople)
        .innerJoin(people, eq(people.id, documentPeople.personId))
        .where(inArray(documentPeople.documentId, docIds)),
      this.suggest.latestForFiles(rows.map((r) => r.df.id)),
      this.tagsService.namesForDocuments(docIds),
    ]);
    const peopleByDoc = new Map<string, { id: string; displayName: string }[]>();
    for (const l of links) peopleByDoc.set(l.documentId, [...(peopleByDoc.get(l.documentId) ?? []), { id: l.id, displayName: l.displayName }]);
    return rows.map(({ doc, df }) => {
      const cat = doc.categoryId ? cats.get(doc.categoryId) : undefined;
      return toSummary(doc, df, cat ? { id: cat.cat.id, name: cat.cat.name, path: cat.path } : null, peopleByDoc.get(doc.id) ?? [], tagNames.get(doc.id) ?? [], sugg.get(df.id) ?? null);
    });
  }
}

export function toSummary(
  doc: DocRow,
  df: FileRow,
  category: DocumentSummary["category"],
  folks: DocumentSummary["people"],
  tagNames: string[],
  suggestion: SuggestionView | null,
): DocumentSummary {
  return {
    id: doc.id,
    title: doc.title,
    source: doc.source,
    createdAt: doc.createdAt.toISOString(),
    documentDate: doc.documentDate,
    expiresAt: doc.expiresAt,
    notes: doc.notes,
    category,
    people: folks,
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
    },
  };
}

export function titleFromFilename(name: string): string {
  const base = path.basename(name).replace(/\.[a-z0-9]{2,5}$/i, "");
  const cleaned = base.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Untitled document").slice(0, 120);
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
