import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { documents, emailIngestLog, mailConnections, mailSenders, type Db } from "@harbor/db";
import type { ApproveSenders, HeldMessage, InboxSender, MailSenderView, MuteResult, MuteSenders } from "@harbor/shared";
import { AuditService } from "../audit/audit.service";
import { InjectDb } from "../db/db.module";

/**
 * Sender rules and the held mail they act on (spec §7.6, §7.7).
 *
 * Approving is deliberately bulk and per-sender: you say "everything from Stadtwerke is a utility
 * bill for Musterstraße 7" once, and every held message from them, and every future one, follows.
 * The alternative — deciding message by message — is the work this feature exists to remove.
 *
 * Everything here is owner-scoped. Unfiled mail is correspondence, not a document, and §7.7 keeps
 * it to the person whose mailbox it came from until filing makes it shared.
 */
@Injectable()
export class MailSendersService {
  private readonly log = new Logger(MailSendersService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(connectionId: string, actorUserId: string): Promise<MailSenderView[]> {
    await this.assertOwner(connectionId, actorUserId);
    const rows = await this.db.select().from(mailSenders).where(eq(mailSenders.connectionId, connectionId)).orderBy(mailSenders.fromAddr);
    return rows.map((r) => ({
      id: r.id,
      fromAddr: r.fromAddr,
      decision: r.decision,
      defaultCategorySlug: r.defaultCategorySlug,
      defaultItemLabels: r.defaultItemLabels,
      defaultTags: r.defaultTags,
      learnedFrom: r.learnedFrom,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /**
   * One decision applied to many senders — the backfill review's only action (§7.6). Re-approving
   * an address updates the rule rather than adding a second one, so the review screen is safe to
   * use twice.
   */
  async approve(connectionId: string, input: ApproveSenders, actorUserId: string): Promise<MailSenderView[]> {
    await this.assertOwner(connectionId, actorUserId);
    const addresses = [...new Set(input.fromAddrs.map((a) => a.toLowerCase().trim()).filter(Boolean))];
    if (!addresses.length) return [];

    await this.db
      .insert(mailSenders)
      .values(
        addresses.map((fromAddr) => ({
          connectionId,
          fromAddr,
          decision: input.decision,
          defaultCategorySlug: input.defaultCategorySlug ?? null,
          defaultItemLabels: input.defaultItemLabels ?? [],
          defaultTags: input.defaultTags ?? [],
          learnedFrom: input.learnedFrom ?? ("backfill" as const),
        })),
      )
      .onConflictDoUpdate({
        target: [mailSenders.connectionId, mailSenders.fromAddr],
        set: {
          decision: input.decision,
          defaultCategorySlug: input.defaultCategorySlug ?? null,
          defaultItemLabels: input.defaultItemLabels ?? [],
          defaultTags: input.defaultTags ?? [],
          updatedAt: new Date(),
        },
      });

    // An ignored sender's held mail is resolved on the spot: there is nothing left to decide, and
    // leaving it in the review would ask the same question again tomorrow.
    if (input.decision === "ignore") {
      await this.db
        .update(emailIngestLog)
        .set({ status: "rejected", heldReason: "sender is on the ignore list" })
        .where(and(eq(emailIngestLog.connectionId, connectionId), eq(emailIngestLog.status, "held"), inArray(emailIngestLog.fromAddr, addresses)));
    }

    await this.audit.record({
      action: "mail_sender.approve",
      actorUserId,
      entityType: "mail_connection",
      entityId: connectionId,
      metadata: { decision: input.decision, senders: addresses.length, category: input.defaultCategorySlug ?? null },
    });
    return this.list(connectionId, actorUserId);
  }

  async remove(connectionId: string, senderId: string, actorUserId: string): Promise<void> {
    await this.assertOwner(connectionId, actorUserId);
    await this.db.delete(mailSenders).where(and(eq(mailSenders.id, senderId), eq(mailSenders.connectionId, connectionId)));
    await this.audit.record({ action: "mail_sender.delete", actorUserId, entityType: "mail_connection", entityId: connectionId, metadata: { senderId } });
  }

  /** The held-mail review (§7.6). Owner-only, like everything unfiled (§7.7). */
  async held(connectionId: string, actorUserId: string, limit = 200): Promise<HeldMessage[]> {
    await this.assertOwner(connectionId, actorUserId);
    const rows = await this.db
      .select()
      .from(emailIngestLog)
      .where(and(eq(emailIngestLog.connectionId, connectionId), eq(emailIngestLog.status, "held")))
      .orderBy(desc(emailIngestLog.receivedAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      fromAddr: r.fromAddr,
      subject: r.subject,
      folder: r.folder,
      tier: r.tier,
      heldReason: r.heldReason,
      receivedAt: r.receivedAt.toISOString(),
    }));
  }

  /**
   * Held messages whose sender now says `file`. The fetcher works from this list, so approving a
   * sender files their backlog rather than only their next message — which is what someone
   * approving a sender in the backfill review plainly means.
   */
  async pendingForRules(connectionId: string): Promise<{ id: string; folder: string; imapUid: number | null; fromAddr: string; messageId: string }[]> {
    const rows = await this.db
      .select({
        id: emailIngestLog.id,
        folder: emailIngestLog.folder,
        imapUid: emailIngestLog.imapUid,
        fromAddr: emailIngestLog.fromAddr,
        messageId: emailIngestLog.messageId,
      })
      .from(emailIngestLog)
      .innerJoin(mailSenders, and(eq(mailSenders.connectionId, emailIngestLog.connectionId), eq(mailSenders.fromAddr, emailIngestLog.fromAddr)))
      .where(and(eq(emailIngestLog.connectionId, connectionId), eq(emailIngestLog.status, "held"), eq(mailSenders.decision, "file")));
    return rows;
  }

  async markFiled(logId: string, documentIds: string[]): Promise<void> {
    await this.db.update(emailIngestLog).set({ status: "accepted", heldReason: null, documentIds }).where(eq(emailIngestLog.id, logId));
  }

  /**
   * Senders whose documents are sitting in the Inbox, newest first (§7.6).
   *
   * Scoped to the caller's own connections, like everything else about unfiled mail (§7.7) — and
   * the documents themselves are shared, so this is about who may act on the grouping, not about
   * hiding anything already filed.
   */
  async inboxSenders(actorUserId: string): Promise<InboxSender[]> {
    // From the documents themselves (§7.11): the ingest log is prunable, and joining through its
    // array column meant a pruned row silently detached a document from whoever sent it.
    const rows = await this.db
      .select({ mailFrom: documents.mailFrom, documentId: documents.id, createdAt: documents.createdAt })
      .from(documents)
      .where(and(eq(documents.source, "email"), isNotNull(documents.mailFrom), isNull(documents.deletedAt), isNull(documents.categoryId)));

    const owned = await this.db
      .select({ id: mailConnections.id })
      .from(mailConnections)
      .where(eq(mailConnections.ownerUserId, actorUserId));
    const connectionId = owned[0]?.id;
    if (!connectionId) return [];

    const muted = new Set(
      (await this.db.select({ fromAddr: mailSenders.fromAddr }).from(mailSenders).where(and(eq(mailSenders.connectionId, connectionId), eq(mailSenders.decision, "ignore")))).map((r) => r.fromAddr),
    );

    const byAddr = new Map<string, InboxSender>();
    for (const r of rows) {
      const addr = r.mailFrom!;
      const at = r.createdAt.toISOString();
      const existing = byAddr.get(addr);
      if (existing) {
        existing.documentIds.push(r.documentId);
        if (at > existing.latestAt) existing.latestAt = at;
      } else {
        byAddr.set(addr, { fromAddr: addr, connectionId, documentIds: [r.documentId], latestAt: at, muted: muted.has(addr) });
      }
    }
    return [...byAddr.values()].sort((a, b) => b.documentIds.length - a.documentIds.length || b.latestAt.localeCompare(a.latestAt));
  }

  /**
   * "Never file from this sender." Two halves, and both matter: the rule stops the next one
   * (`detect` refuses a muted sender before downloading anything), and the sweep clears what they
   * have already sent. Muting without the sweep would leave the pile you were trying to clear.
   *
   * The delete is soft — Recently deleted holds it — because a mute is a bulk judgement made
   * quickly, and being able to take it back is what makes it safe to make quickly.
   */
  async mute(input: MuteSenders, actorUserId: string): Promise<MuteResult> {
    const addresses = [...new Set(input.fromAddrs.map((a) => a.toLowerCase().trim()).filter(Boolean))];
    if (!addresses.length) return { muted: 0, deleted: 0 };

    // Only connections this person owns; a mute on someone else's mailbox is not theirs to set.
    const owned = await this.db
      .select({ id: mailConnections.id })
      .from(mailConnections)
      .where(eq(mailConnections.ownerUserId, actorUserId));
    if (!owned.length) return { muted: 0, deleted: 0 };

    const rules = owned.flatMap((c) => addresses.map((fromAddr) => ({ connectionId: c.id, fromAddr, decision: "ignore" as const, learnedFrom: "manual" as const })));
    await this.db
      .insert(mailSenders)
      .values(rules)
      .onConflictDoUpdate({ target: [mailSenders.connectionId, mailSenders.fromAddr], set: { decision: "ignore", updatedAt: new Date() } });

    let deleted = 0;
    if (input.deleteFiled) {
      // From `documents.mail_from`, not from a join through the ingest log. The log is prunable
      // (§7.8), and a document whose row had gone would have been silently left behind — so the
      // card you clicked could survive its own "delete and disregard all".
      const swept = await this.db
        .update(documents)
        .set({ deletedAt: new Date() })
        .where(
          and(
            inArray(documents.mailFrom, addresses),
            isNull(documents.deletedAt),
            // Only what is still unfiled: a document someone has already filed to a category is
            // no longer mail, it is part of the vault.
            isNull(documents.categoryId),
          ),
        )
        .returning({ id: documents.id });
      deleted = swept.length;
    }

    await this.audit.record({
      action: "mail_sender.mute",
      actorUserId,
      entityType: "mail_connection",
      entityId: owned[0]!.id,
      metadata: { senders: addresses.length, deleted },
    });
    return { muted: addresses.length, deleted };
  }

  private async assertOwner(connectionId: string, actorUserId: string): Promise<void> {
    const row = await this.db
      .select({ ownerUserId: mailConnections.ownerUserId })
      .from(mailConnections)
      .where(eq(mailConnections.id, connectionId))
      .limit(1)
      .then((r) => r[0]);
    if (!row) throw new NotFoundException("mail connection not found");
    if (row.ownerUserId !== actorUserId) {
      throw new ForbiddenException("Unfiled mail belongs to the person whose mailbox it came from. Only they can review it.");
    }
  }
}
