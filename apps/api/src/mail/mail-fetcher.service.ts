import { Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { documents, emailIngestLog, mailConnections, mailSenders, type Db, type FolderCursor } from "@harbor/db";
import { BACKFILL_MONTHS } from "@harbor/shared";
import { BlobStore } from "../storage/blob-store.service";
import { DocumentsService } from "../documents/documents.service";
import { InjectDb } from "../db/db.module";
import { ImapSource } from "./imap.source";
import { MailConnectionsService, explain } from "./mail-connections.service";
import { MailSendersService } from "./mail-senders.service";
import { DEFAULT_CAPS, detect, type Detection, type SenderRule } from "./mail-detector";
import type { MailEnvelope, MailSource, MailSourceConfig } from "./mail-source";

/** §7.5: one pass never reads more than this, however far behind it is. The next pass continues. */
const MESSAGES_PER_PASS = 200;
/** A hard stop, so one explicit action over a decade-old mailbox cannot become an unbounded one. */
const MESSAGES_PER_BACKFILL = 20_000;

interface PassOptions {
  /** Read every folder the server offers, not just the connection's — the backfill only (§7.4). */
  allFolders?: boolean;
  /** Reach back to this date instead of following the cursor. */
  since?: Date;
  limit?: number;
}

export interface SyncSummary {
  connectionId: string;
  scanned: number;
  filed: number;
  held: number;
  documentIds: string[];
  problem: string | null;
}

/**
 * One sync pass over one mailbox (spec §7.4–7.5). Envelopes in, documents out, and a row in
 * `email_ingest_log` for everything that was a candidate either way.
 *
 * Two things this deliberately does not do. It never widens its own scope: a `folder`-mode
 * connection opens the folders it was given and no others, whatever else the server offers. And
 * it never reaches backwards past the moment it was connected — history is the explicit backfill's
 * job (§7.6), so connecting a mailbox does not quietly ingest a decade of it.
 */
@Injectable()
export class MailFetcherService {
  private readonly log = new Logger(MailFetcherService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly connections: MailConnectionsService,
    private readonly documents: DocumentsService,
    private readonly blobs: BlobStore,
    private readonly senders: MailSendersService,
  ) {}

  async syncAll(make?: SourceFactory): Promise<SyncSummary[]> {
    const rows = await this.db.select({ id: mailConnections.id }).from(mailConnections).where(eq(mailConnections.status, "ok"));
    const summaries: SyncSummary[] = [];
    for (const row of rows) summaries.push(await this.syncConnection(row.id, make));
    return summaries;
  }

  syncConnection(connectionId: string, make: SourceFactory = (c) => new ImapSource(c)): Promise<SyncSummary> {
    return this.run(connectionId, make, {});
  }

  private async run(connectionId: string, make: SourceFactory, opts: PassOptions): Promise<SyncSummary> {
    const summary: SyncSummary = { connectionId, scanned: 0, filed: 0, held: 0, documentIds: [], problem: null };
    const connection = await this.db.select().from(mailConnections).where(eq(mailConnections.id, connectionId)).limit(1).then((r) => r[0]);
    if (!connection || connection.status === "disabled") return summary;

    const config = await this.connections.configFor(connectionId);
    const source = make(config);
    const rules = await this.loadRules(connectionId);

    try {
      await source.connect();
      // `folder` mode opens what it was told to and nothing else — the whole point of §7.4. The
      // backfill is the one exception, and it is the one thing the user triggers by hand.
      const folders = opts.allFolders || connection.scopeMode === "senders" ? await source.listFolders() : connection.folders;
      if (opts.since) this.log.log(`scanning ${folders.length} folders back to ${opts.since.toISOString().slice(0, 10)}`);

      for (const folder of folders) {
        if (summary.scanned >= (opts.limit ?? MESSAGES_PER_PASS)) break;
        await this.syncFolder(connection, source, folder, rules, summary, opts);
      }
      await this.connections.recordStatus(connectionId, "ok", null);
    } catch (err) {
      const { problem } = explain(err as Error, config);
      summary.problem = problem;
      const status = /rejected the username or password/.test(problem) ? "auth_failed" : "unreachable";
      await this.connections.recordStatus(connectionId, status, problem);
      this.log.warn(`${connection.emailAddress}: ${problem}`);
    } finally {
      await source.close().catch(() => undefined);
    }
    return summary;
  }

  /**
   * File the backlog a sender approval just unlocked (§7.6). Approving Stadtwerke in the backfill
   * review plainly means "and the eleven you already found", not "from now on" — so held messages
   * whose sender now says `file` are downloaded and filed here, in one pass over one connection.
   */
  async applyRules(connectionId: string, make: SourceFactory = (c) => new ImapSource(c)): Promise<SyncSummary> {
    const summary: SyncSummary = { connectionId, scanned: 0, filed: 0, held: 0, documentIds: [], problem: null };
    const connection = await this.db.select().from(mailConnections).where(eq(mailConnections.id, connectionId)).limit(1).then((r) => r[0]);
    if (!connection) return summary;

    const pending = await this.senders.pendingForRules(connectionId);
    if (!pending.length) return summary;

    const rules = await this.loadRules(connectionId);
    const source = make(await this.connections.configFor(connectionId));
    try {
      await source.connect();
      for (const held of pending) {
        if (held.imapUid === null) continue;
        summary.scanned += 1;
        const rule = rules.get(held.fromAddr.toLowerCase()) ?? null;

        // Re-read the manifest rather than trusting what the backfill recorded: the message may
        // have moved or been deleted since, and its parts were never stored.
        const envelope = await this.envelopeFor(source, held.folder, held.imapUid);
        if (!envelope) {
          this.log.warn(`${held.messageId} is no longer in ${held.folder}; leaving it held`);
          continue;
        }
        const detection = detect(envelope, rule, DEFAULT_CAPS);
        if (detection.decision !== "file") {
          summary.held += 1;
          continue;
        }
        const { documentIds, created } = await this.file(connection, source, held.folder, envelope, detection.attachments, rule);
        if (documentIds.length) {
          await this.senders.markFiled(held.id, documentIds);
          summary.filed += created;
          summary.documentIds.push(...documentIds);
        }
      }
    } catch (err) {
      summary.problem = explain(err as Error, await this.connections.configFor(connectionId)).problem;
    } finally {
      await source.close().catch(() => undefined);
    }
    return summary;
  }

  private async envelopeFor(source: MailSource, folder: string, uid: number): Promise<MailEnvelope | null> {
    for await (const envelope of source.scan(folder, { sinceUid: uid - 1 })) {
      if (envelope.uid === uid) return envelope;
      break;
    }
    return null;
  }

  /**
   * The explicit backfill (§7.4, §7.6): every folder, back to `BACKFILL_MONTHS`, ignoring the
   * cursor. Deliberately the same pass as the ordinary sync with a wider range — it had its own
   * copy of this loop once, and the copy kept holding mail after the ordinary path had been
   * changed to file it.
   */
  async backfill(connectionId: string, make: SourceFactory = (c) => new ImapSource(c), months = BACKFILL_MONTHS): Promise<SyncSummary> {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    await this.db
      .update(mailConnections)
      .set({ backfillStartedAt: new Date(), backfillCompletedAt: null, backfillMonths: months })
      .where(eq(mailConnections.id, connectionId));

    const summary = await this.run(connectionId, make, { allFolders: true, since, limit: MESSAGES_PER_BACKFILL });
    await this.db.update(mailConnections).set({ backfillCompletedAt: new Date() }).where(eq(mailConnections.id, connectionId));
    this.log.log(`backfill of ${connectionId}: scanned ${summary.scanned} · filed ${summary.filed} · held ${summary.held}`);
    return summary;
  }

  private async syncFolder(
    connection: typeof mailConnections.$inferSelect,
    source: MailSource,
    folder: string,
    rules: Map<string, SenderRule>,
    summary: SyncSummary,
    opts: PassOptions,
  ): Promise<void> {
    const { uidValidity, exists } = await source.openFolder(folder);
    // Announced before the work, not after: a folder that takes minutes is indistinguishable from
    // a hung process otherwise, which is exactly how a slow archive folder looked.
    if (opts.since) this.log.log(`  ${folder} (${exists} messages)…`);
    const cursor = scanRangeFor(connection.uidvalidity[folder], uidValidity, connection.createdAt);
    // The backfill reaches past the cursor on purpose; the ordinary sync never does.
    const range = opts.since ? { since: opts.since } : cursor.range;

    /**
     * Two phases, and the split is not stylistic.
     *
     * A FETCH is a stream on the one IMAP connection, and ImapFlow queues any further command
     * behind it. Downloading an attachment from inside the loop therefore waits for a fetch that
     * cannot finish until the loop lets go — a deadlock that presents as a folder scanning
     * forever, then as a socket timeout minutes later. So the scan only decides, holding nothing
     * open but the iterator, and the downloads happen once it has drained.
     */
    const decided: { envelope: MailEnvelope; detection: Detection }[] = [];
    let lastUid = cursor.lastUid;
    for await (const envelope of source.scan(folder, range)) {
      if (summary.scanned >= (opts.limit ?? MESSAGES_PER_PASS)) break;
      summary.scanned += 1;
      lastUid = Math.max(lastUid, envelope.uid);

      // Only the database is touched in here; every IMAP command waits for the phase below.
      const detection = await this.classify(connection, envelope, rules);
      if (detection) decided.push({ envelope, detection });
    }

    for (const { envelope, detection } of decided) {
      await this.act(connection, source, folder, envelope, detection, summary);
    }

    await this.db
      .update(mailConnections)
      .set({ uidvalidity: { ...connection.uidvalidity, [folder]: { uidValidity, lastUid } } })
      .where(eq(mailConnections.id, connection.id));

    if (opts.since) this.log.log(`  ${folder} done · ${summary.scanned} scanned so far · ${summary.filed} filed`);
  }

  /**
   * Phase one: decide, touching nothing but the database. Returns null for mail that needs no
   * row and no action — most of a mailbox.
   */
  private async classify(
    connection: typeof mailConnections.$inferSelect,
    envelope: MailEnvelope,
    rules: Map<string, SenderRule>,
  ): Promise<Detection | null> {
    const rule = envelope.fromAddress ? (rules.get(envelope.fromAddress) ?? null) : null;
    const detection = detect(envelope, rule, DEFAULT_CAPS);

    // Mail that was never a candidate is not written to the log: a row per newsletter would bury
    // the decisions that matter under the ones that never were.
    //
    // This test comes before the dedupe query on purpose. `detect` is pure and free; `alreadySeen`
    // is a round-trip. Asking the database first meant one query per message scanned — tens of
    // thousands across a backfill, to decide nothing.
    if (detection.decision === "ignore" && detection.tier === null) return null;
    if (await this.alreadySeen(connection.id, envelope.messageId)) return null;
    return detection;
  }

  /** Phase two: download and file. Safe only once the folder's fetch has drained. */
  private async act(
    connection: typeof mailConnections.$inferSelect,
    source: MailSource,
    folder: string,
    envelope: MailEnvelope,
    detection: Detection,
    summary: SyncSummary,
  ): Promise<void> {
    if (detection.decision !== "file") {
      await this.record(connection.id, folder, envelope, detection.decision === "ignore" ? "rejected" : "held", detection.tier, detection.reason, []);
      if (detection.decision === "hold") summary.held += 1;
      return;
    }

    const { documentIds, created } = await this.file(connection, source, folder, envelope, detection.attachments, detection.rule);
    await this.record(connection.id, folder, envelope, "accepted", detection.tier, null, documentIds);
    // Only genuinely new documents count as filed. Linking a message to a copy already in the
    // vault is the right outcome, but reporting it as "filed 19" when two arrived is a lie.
    summary.filed += created;
    summary.documentIds.push(...documentIds);
  }

  /**
   * Download the attachments and hand them to Stage 0 unchanged (§2). Each one becomes its own
   * document: two invoices in one mail are two pieces of paper, and joining them would be a
   * decision the sender did not make.
   */
  private async file(
    connection: typeof mailConnections.$inferSelect,
    source: MailSource,
    folder: string,
    envelope: MailEnvelope,
    attachments: { part: string; filename: string | null }[],
    rule: SenderRule | null,
  ): Promise<{ documentIds: string[]; created: number }> {
    const documentIds: string[] = [];
    let created = 0;

    for (const attachment of attachments) {
      const name = attachment.filename ?? `${envelope.subject ?? "attachment"}.pdf`;
      const temp = this.blobs.newTempPath();
      try {
        const bytes = await source.download(folder, envelope.uid, attachment.part);

        /**
         * The same bytes are the same document, whoever sent them and however often.
         *
         * `(connection_id, message_id)` stops a message being read twice, but it cannot stop the
         * same PDF arriving twice: a reminder re-attaches the invoice it is chasing, an invoice
         * is copied to two connected mailboxes, a sender re-sends with a fresh Message-ID. §2
         * already keeps a sha256 for exactly this and the upload path prompts on it — there is
         * nobody to prompt here, so the honest answer is to skip and keep the copy already filed.
         */
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const existing = await this.documents.findDuplicate(sha256);
        if (existing) {
          this.log.log(`${name}: already in the vault as "${existing.title}"; not filing a second copy`);
          // Heal a document filed before the sender was stored on it, or one orphaned by a pruned
          // log: we have the envelope in hand, so a rescan repairs the attribution for free.
          if (envelope.fromAddress) {
            await this.db
              .update(documents)
              .set({ mailFrom: envelope.fromAddress })
              .where(and(eq(documents.id, existing.documentId), isNull(documents.mailFrom)));
          }
          documentIds.push(existing.documentId);
          continue;
        }

        await writeFile(temp, bytes, { mode: 0o600 });

        const result = await this.documents.ingest(
          { path: temp, originalName: name, byteSize: bytes.length },
          {
            // Slugs and labels, resolved against the current vocabulary — unknown values are
            // dropped rather than failing the ingest, exactly as a suggestion's are.
            categoryId: undefined,
            itemIds: [],
            tags: rule?.defaultTags ?? [],
          },
          { userId: connection.ownerUserId, source: "email", mailFrom: envelope.fromAddress },
        );
        documentIds.push(result.document.id);
        created += 1;
      } catch (err) {
        // One bad attachment must not cost the others in the same message.
        this.log.warn(`${envelope.messageId}: could not file ${name}: ${(err as Error).message}`);
      } finally {
        await rm(temp, { force: true });
      }
    }
    return { documentIds, created };
  }

  private async alreadySeen(connectionId: string, messageId: string): Promise<boolean> {
    const row = await this.db
      .select({ id: emailIngestLog.id })
      .from(emailIngestLog)
      .where(and(eq(emailIngestLog.connectionId, connectionId), eq(emailIngestLog.messageId, messageId)))
      .limit(1);
    return row.length > 0;
  }

  private async record(
    connectionId: string,
    folder: string,
    envelope: MailEnvelope,
    status: "accepted" | "held" | "rejected",
    tier: number | null,
    heldReason: string | null,
    documentIds: string[],
  ): Promise<void> {
    await this.db
      .insert(emailIngestLog)
      .values({
        connectionId,
        messageId: envelope.messageId,
        imapUid: envelope.uid,
        folder,
        tier,
        fromAddr: envelope.fromAddress ?? "(no sender)",
        subject: envelope.subject?.slice(0, 500) ?? null,
        status,
        heldReason,
        // Never on a connected inbox: the message is still in the mailbox (§7.8).
        rawBlobKey: null,
        documentIds,
        receivedAt: envelope.date,
      })
      // Two passes racing on the same message is a no-op, not a duplicate document.
      .onConflictDoNothing({ target: [emailIngestLog.connectionId, emailIngestLog.messageId] });
  }

  private async loadRules(connectionId: string): Promise<Map<string, SenderRule>> {
    const rows = await this.db.select().from(mailSenders).where(eq(mailSenders.connectionId, connectionId));
    return new Map(
      rows.map((r) => [
        r.fromAddr.toLowerCase(),
        { decision: r.decision, defaultCategorySlug: r.defaultCategorySlug, defaultItemLabels: r.defaultItemLabels, defaultTags: r.defaultTags },
      ]),
    );
  }
}

export type SourceFactory = (config: MailSourceConfig) => MailSource;

/**
 * Where this folder's pass should start, and it is only ever one of two answers (§7.5).
 *
 * With a valid cursor, continue past the last UID seen. Without one — a first pass, or a server
 * that renumbered the mailbox — fall back to a date, and never a UID: after a UIDVALIDITY change
 * the old numbers point at different messages, so trusting them would skip real mail. The date is
 * when the connection was made, because history belongs to the explicit backfill (§7.6) and
 * connecting a mailbox must not quietly ingest a decade of it.
 *
 * Re-reading by date is safe precisely because it is cheap and idempotent: envelopes only, and
 * `(connection_id, message_id)` stops anything already seen from being ingested twice.
 */
export function scanRangeFor(
  cursor: FolderCursor | undefined,
  uidValidity: number,
  connectedAt: Date,
): { range: { sinceUid: number } | { since: Date }; lastUid: number } {
  if (cursor && cursor.uidValidity === uidValidity) return { range: { sinceUid: cursor.lastUid }, lastUid: cursor.lastUid };
  return { range: { since: connectedAt }, lastUid: 0 };
}
