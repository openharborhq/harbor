import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { emailIngestLog, mailConnections, mailSenders, type Db } from "@harbor/db";
import type { BackfillCandidateSender } from "@harbor/shared";
import { InjectDb } from "../db/db.module";

// The hard stop on a backfill is MESSAGES_PER_BACKFILL in MailFetcherService, which is the
// thing that actually reads the mailbox. A second copy of the number lived here and was never
// consulted — the sort of duplicate that quietly disagrees after someone edits one of them.

/**
 * The review screen behind the backfill (§7.6).
 *
 * The scan itself lives in `MailFetcherService` — the backfill is the ordinary pass with a wider
 * range, and keeping a second copy of that loop here is precisely how the backfill went on
 * holding mail after the ordinary path had been changed to file it.
 *
 * What is left is the question the screen answers: who is sending paperwork into this vault, and
 * do you want to keep hearing from them.
 */
@Injectable()
export class MailBackfillService {
  private readonly log = new Logger(MailBackfillService.name);

  constructor(@InjectDb() private readonly db: Db) {}

  /**
   * The review screen (§7.6): senders, not messages. One row per address with what it sent and
   * when, so approving is a judgement about a correspondent rather than about 142 emails.
   */
  async sendersSeen(connectionId: string, actorUserId: string): Promise<BackfillCandidateSender[]> {
    // Candidates are unfiled mail, and unfiled mail is the owner's alone (§7.7).
    const owner = await this.db
      .select({ ownerUserId: mailConnections.ownerUserId })
      .from(mailConnections)
      .where(eq(mailConnections.id, connectionId))
      .limit(1)
      .then((r) => r[0]);
    if (!owner) throw new NotFoundException("mail connection not found");
    if (owner.ownerUserId !== actorUserId) {
      throw new ForbiddenException("Unfiled mail belongs to the person whose mailbox it came from. Only they can review it.");
    }

    const rows = await this.db
      .select({
        fromAddr: emailIngestLog.fromAddr,
        messages: sql<number>`count(*)::int`,
        withAttachments: sql<number>`count(*) filter (where ${emailIngestLog.status} = 'accepted')::int`,
        lastSeen: sql<Date>`max(${emailIngestLog.receivedAt})`,
        sampleSubject: sql<string | null>`(array_agg(${emailIngestLog.subject} order by ${emailIngestLog.receivedAt} desc))[1]`,
        decision: mailSenders.decision,
      })
      .from(emailIngestLog)
      .leftJoin(mailSenders, and(eq(mailSenders.connectionId, emailIngestLog.connectionId), eq(mailSenders.fromAddr, emailIngestLog.fromAddr)))
      // Every sender the connection has seen, not just held mail: now that an attachment files
      // itself, "held" means a cap violation and would leave this screen empty.
      .where(eq(emailIngestLog.connectionId, connectionId))
      .groupBy(emailIngestLog.fromAddr, mailSenders.decision)
      .orderBy(sql`count(*) desc`);

    return rows.map((r) => ({
      fromAddr: r.fromAddr,
      messages: r.messages,
      withAttachments: r.withAttachments,
      lastSeen: new Date(r.lastSeen).toISOString(),
      sampleSubject: r.sampleSubject,
      decision: r.decision ?? null,
    }));
  }
}
