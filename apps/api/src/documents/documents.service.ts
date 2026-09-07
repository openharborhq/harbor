import { Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Queue } from "bullmq";
import { open, rm } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { documentFiles, documents, type Db } from "@trustworthier/db";
import type { DocumentSummary, UploadResult } from "@trustworthier/shared";
import { AuditService } from "../audit/audit.service";
import { MIME_BY_KIND, sniffKind } from "../common/sniff";
import { CryptoService } from "../crypto/crypto.service";
import { InjectDb } from "../db/db.module";
import { InjectProcessFileQueue, type ProcessFileJob } from "../queue/queue.module";
import { BlobStore } from "../storage/blob-store.service";

export interface IncomingFile {
  /** Path of the plaintext temp file written by the upload middleware. Deleted by this service. */
  path: string;
  originalName: string;
  byteSize: number;
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly blobs: BlobStore,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    @InjectProcessFileQueue() private readonly queue: Queue<ProcessFileJob>,
  ) {}

  /**
   * Stage 0 intake (spec §2): hash, duplicate check, encrypt, insert, enqueue. The plaintext temp
   * file is removed on every path. Duplicates are reported, never silently merged.
   */
  async ingestUpload(file: IncomingFile, userId: string, ip: string | null): Promise<UploadResult> {
    try {
      const [sha256, head] = await Promise.all([this.blobs.sha256(file.path), readHead(file.path)]);
      const kind = sniffKind(head);
      const duplicateOf = await this.findDuplicate(sha256);

      const dek = this.crypto.generateDek();
      const sealed = await this.blobs.sealFile(file.path, dek);
      const dekWrapped = this.blobs.wrapDek(dek, sealed.storageKey);
      dek.fill(0);

      const title = titleFromFilename(file.originalName);
      const created = await this.db.transaction(async (tx) => {
        const [doc] = await tx
          .insert(documents)
          .values({ title, source: "upload", createdBy: userId })
          .returning();
        const [df] = await tx
          .insert(documentFiles)
          .values({
            documentId: doc!.id,
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
        return { doc: doc!, df: df! };
      });

      await this.queue.add("process", { documentFileId: created.df.id }, { jobId: created.df.id });
      await this.audit.record({
        action: "document.upload",
        actorUserId: userId,
        entityType: "document",
        entityId: created.doc.id,
        metadata: { filename: file.originalName, bytes: sealed.byteSize, kind, duplicateOf: duplicateOf?.documentId ?? null },
        ip,
      });

      return { document: toSummary(created.doc, created.df), duplicateOf };
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

  async list(opts: { inboxOnly?: boolean; limit?: number } = {}): Promise<DocumentSummary[]> {
    const rows = await this.db
      .select({ doc: documents, df: documentFiles })
      .from(documents)
      .innerJoin(documentFiles, and(eq(documentFiles.documentId, documents.id), eq(documentFiles.isCurrent, true)))
      .where(and(isNull(documents.deletedAt), opts.inboxOnly ? isNull(documents.categoryId) : sql`true`))
      .orderBy(desc(documents.createdAt))
      .limit(opts.limit ?? 100);
    return rows.map((r) => toSummary(r.doc, r.df));
  }

  async get(documentId: string): Promise<DocumentSummary> {
    const row = await this.db
      .select({ doc: documents, df: documentFiles })
      .from(documents)
      .innerJoin(documentFiles, and(eq(documentFiles.documentId, documents.id), eq(documentFiles.isCurrent, true)))
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1)
      .then((r) => r[0]);
    if (!row) throw new NotFoundException("Document not found");
    return toSummary(row.doc, row.df);
  }

  /** Decrypted original, streamed. Audited: downloads of family paperwork are worth a row each. */
  async openOriginal(documentId: string, userId: string, ip: string | null): Promise<{ stream: Readable; filename: string; mimeType: string; byteSize: number }> {
    const df = await this.db
      .select({ df: documentFiles })
      .from(documentFiles)
      .innerJoin(documents, eq(documents.id, documentFiles.documentId))
      .where(and(eq(documents.id, documentId), eq(documentFiles.isCurrent, true), isNull(documents.deletedAt)))
      .limit(1)
      .then((r) => r[0]?.df);
    if (!df) throw new NotFoundException("Document not found");

    const dek = this.blobs.unwrapDek(df.dekWrapped, df.storageKey);
    const stream = this.blobs.openStream(df.storageKey, dek, df.iv, df.authTag);
    dek.fill(0);
    await this.audit.record({ action: "document.download", actorUserId: userId, entityType: "document", entityId: documentId, ip });
    return { stream, filename: df.originalFilename, mimeType: df.mimeType, byteSize: df.byteSize };
  }
}

export function toSummary(doc: typeof documents.$inferSelect, df: typeof documentFiles.$inferSelect): DocumentSummary {
  return {
    id: doc.id,
    title: doc.title,
    categoryId: doc.categoryId,
    source: doc.source,
    createdAt: doc.createdAt.toISOString(),
    file: {
      id: df.id,
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
