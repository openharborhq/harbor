import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { Queue } from "bullmq";
import {
  ApproveSenders,
  BackfillRequest,
  CreateMailConnection,
  MuteSenders,
  UpdateMailConnection,
  type BackfillCandidateSender,
  type HeldMessage,
  type InboxSender,
  type MailAutoconfigResult,
  type MailConnectionView,
  type MailSenderView,
  type MuteResult,
  type SessionUser,
} from "@harbor/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { ZodPipe } from "../common/zod.pipe";
import { InjectMailOpsQueue, type MailOpsJob } from "../queue/queue.module";
import { AutodiscoverService } from "./autodiscover.service";
import { gmailFilterXml } from "./gmail-filter";
import { MailBackfillService } from "./mail-backfill.service";
import { MailConnectionsService } from "./mail-connections.service";
import { MailSendersService } from "./mail-senders.service";

/**
 * The API's half of §7: settings, rules, and reading what the fetcher found.
 *
 * It never opens a mailbox. Anything that needs one is a job for `mailfetch`, which is the only
 * process with a route to an IMAP host and the only one that unseals a mail password (§3.6, §7.10).
 * Only a connection id travels over the queue — never a credential.
 */
@Controller("mail")
export class MailController {
  constructor(
    private readonly connections: MailConnectionsService,
    private readonly senders: MailSendersService,
    private readonly backfill: MailBackfillService,
    private readonly autodiscover: AutodiscoverService,
    @InjectMailOpsQueue() private readonly mailOps: Queue<MailOpsJob>,
  ) {}

  /** Step one of the connect form: an address in, IMAP settings out (§7.3). */
  @Get("autodiscover")
  async discover(@Query("email") email: string): Promise<MailAutoconfigResult> {
    const found = await this.autodiscover.discover(email ?? "");
    if (!found) return { kind: "unknown" };
    if (found.unsupported) return { kind: "unsupported", providerHint: found.providerHint, reason: found.reason, alternative: found.alternative };
    const { usernameForm: _usernameForm, ...rest } = found;
    return { kind: "found", ...rest };
  }

  /**
   * The Gmail filter file (§7.3 step 4) — import it in Gmail, then run the connection in
   * `folder` mode so the vault holds a broad credential but only ever opens one label.
   */
  @Get("gmail-filter.xml")
  gmailFilter(@Query("label") label: string | undefined, @Res({ passthrough: true }) res: Response): string {
    res.set({ "content-type": "application/atom+xml; charset=utf-8", "content-disposition": 'attachment; filename="harbor-gmail-filters.xml"' });
    return gmailFilterXml({ label: label || undefined });
  }

  @Get("connections")
  list(): Promise<MailConnectionView[]> {
    return this.connections.list();
  }

  /** Created sealed, then tested — never the other way round, so no password reaches the queue. */
  @Post("connections")
  async create(@Body(new ZodPipe(CreateMailConnection)) body: CreateMailConnection, @CurrentUser() user: SessionUser): Promise<MailConnectionView> {
    const connection = await this.connections.create(body, user.id);
    await this.enqueue("test", connection.id);
    return connection;
  }

  @Patch("connections/:id")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateMailConnection)) body: UpdateMailConnection,
    @CurrentUser() user: SessionUser,
  ): Promise<MailConnectionView> {
    const connection = await this.connections.update(id, body, user.id);
    // A new password or a changed host is worth re-checking without being asked.
    if (body.password || body.folders || body.scopeMode) await this.enqueue("test", id);
    return connection;
  }

  @Delete("connections/:id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<void> {
    await this.connections.remove(id, user.id);
  }

  /**
   * Queued, not awaited. The answer is the connection's own `status`, `statusDetail` and
   * `discoveredFolders` — one place to look for connection health rather than two (§7.10).
   */
  @Post("connections/:id/test")
  @HttpCode(202)
  async test(@Param("id", ParseUUIDPipe) id: string): Promise<{ queued: true }> {
    await this.enqueue("test", id);
    return { queued: true };
  }

  /**
   * The one broad read, and it only ever happens because someone asked for it (§7.4). The window
   * is chosen at the point of asking so a large mailbox can be worked through in stages (§7.6).
   */
  @Post("connections/:id/backfill")
  @HttpCode(202)
  async runBackfill(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(BackfillRequest)) body: BackfillRequest): Promise<{ queued: true }> {
    await this.enqueue("backfill", id, body.months);
    return { queued: true };
  }

  @Post("connections/:id/sync")
  @HttpCode(202)
  async syncNow(@Param("id", ParseUUIDPipe) id: string): Promise<{ queued: true }> {
    await this.enqueue("sync", id);
    return { queued: true };
  }

  /** Who is sending paperwork into the vault, and whether you want to keep hearing from them (§7.6). */
  @Get("connections/:id/candidates")
  candidates(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<BackfillCandidateSender[]> {
    return this.backfill.sendersSeen(id, user.id);
  }

  @Get("connections/:id/senders")
  listSenders(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<MailSenderView[]> {
    return this.senders.list(id, user.id);
  }

  /** Bulk approve or ignore. Approving files the backlog too, not just what arrives next. */
  @Post("connections/:id/senders")
  async approveSenders(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ApproveSenders)) body: ApproveSenders,
    @CurrentUser() user: SessionUser,
  ): Promise<MailSenderView[]> {
    const senders = await this.senders.approve(id, body, user.id);
    if (body.decision === "file") await this.enqueue("apply-rules", id);
    return senders;
  }

  @Delete("connections/:id/senders/:senderId")
  @HttpCode(204)
  async removeSender(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("senderId", ParseUUIDPipe) senderId: string,
    @CurrentUser() user: SessionUser,
  ): Promise<void> {
    await this.senders.remove(id, senderId, user.id);
  }

  /**
   * Bulk triage for the Inbox (§7.6): who sent what is still sitting there, so a backfill can be
   * cleared a sender at a time instead of a document at a time.
   */
  @Get("inbox-senders")
  inboxSenders(@CurrentUser() user: SessionUser): Promise<InboxSender[]> {
    return this.senders.inboxSenders(user.id);
  }

  /** "Never file from this sender" — the rule, and the sweep of what they already sent. */
  @Post("senders/mute")
  @HttpCode(200)
  mute(@Body(new ZodPipe(MuteSenders)) body: MuteSenders, @CurrentUser() user: SessionUser): Promise<MuteResult> {
    return this.senders.mute(body, user.id);
  }

  /** Owner-only: unfiled mail is correspondence, not a document (§7.7). */
  @Get("connections/:id/held")
  held(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<HeldMessage[]> {
    return this.senders.held(id, user.id);
  }

  /**
   * No fixed jobId: BullMQ treats a repeated id as already-seen and silently drops it, and since
   * completed jobs are retained, "Test" would work once per connection and then quietly stop.
   * Duplicates are harmless instead — the worker runs one mailbox at a time, and both the backfill
   * and the sync are idempotent through `(connection_id, message_id)`.
   */
  private async enqueue(kind: MailOpsJob["kind"], connectionId: string, months?: number): Promise<void> {
    await this.mailOps.add(kind, { kind, connectionId, months });
  }
}
