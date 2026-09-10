import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { mailConnections, users, type Db } from "@harbor/db";
import type { CreateMailConnection, MailConnectionView, UpdateMailConnection } from "@harbor/shared";
import { AuditService } from "../audit/audit.service";
import { CryptoService } from "../crypto/crypto.service";
import { InjectDb } from "../db/db.module";
import { ImapSource } from "./imap.source";
import type { MailSource, MailSourceConfig } from "./mail-source";

/**
 * Mail connections: stored, tested, and handed to the fetcher (spec §7).
 *
 * The app password is sealed under the KEK the moment it arrives and is never read back out of
 * here except to open a connection. No view carries it, no update returns it, and it is not in
 * anything the API serialises — §7.10 promises that in words, and this is where it has to be true.
 */
@Injectable()
export class MailConnectionsService {
  private readonly log = new Logger(MailConnectionsService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /** Every connection in the vault. Held mail is owner-scoped (§7.7); the connections themselves are not. */
  async list(): Promise<MailConnectionView[]> {
    const rows = await this.db
      .select({ c: mailConnections, ownerName: users.displayName })
      .from(mailConnections)
      .leftJoin(users, eq(users.id, mailConnections.ownerUserId))
      .orderBy(desc(mailConnections.createdAt));
    return rows.map((r) => toView(r.c, r.ownerName));
  }

  async create(input: CreateMailConnection, actorUserId: string): Promise<MailConnectionView> {
    const kind = input.isForwardingMailbox ? "forwarding" : "inbox";
    if (kind === "inbox" && input.retentionDays !== null) {
      // Not silently ignored: someone asking for this has misunderstood what the vault owns (§7.8).
      throw new BadRequestException("A connected inbox cannot have a retention period — the vault never deletes mail from a mailbox it does not own. Set it only on a dedicated forwarding mailbox.");
    }

    const existing = await this.db
      .select({ id: mailConnections.id })
      .from(mailConnections)
      .where(and(eq(mailConnections.ownerUserId, actorUserId), eq(mailConnections.emailAddress, input.emailAddress)))
      .limit(1);
    if (existing.length) {
      // Two connections to one mailbox each keep their own ingest log, so the same invoice would
      // be filed twice once its sender is approved.
      throw new BadRequestException(`${input.emailAddress} is already connected. Update that connection instead of adding it again.`);
    }

    const [created] = await this.db
      .insert(mailConnections)
      .values({
        ownerUserId: actorUserId,
        label: input.label,
        emailAddress: input.emailAddress,
        kind,
        providerHint: input.providerHint,
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        imapUsername: input.imapUsername,
        secretEnc: this.crypto.sealString(input.password),
        scopeMode: input.scopeMode,
        folders: input.folders,
        retentionDays: input.retentionDays,
      })
      .returning();
    if (!created) throw new Error("failed to create mail connection");

    await this.audit.record({
      action: "mail_connection.create",
      actorUserId,
      entityType: "mail_connection",
      entityId: created.id,
      // Host and scope, never the address's password and never the folder contents.
      metadata: { kind, host: input.imapHost, scopeMode: input.scopeMode },
    });
    return toView(created, null);
  }

  async update(id: string, input: UpdateMailConnection, actorUserId: string): Promise<MailConnectionView> {
    const existing = await this.require(id);
    this.assertOwner(existing, actorUserId);

    const set: Partial<typeof mailConnections.$inferInsert> = {};
    if (input.label !== undefined) set.label = input.label;
    if (input.scopeMode !== undefined) set.scopeMode = input.scopeMode;
    if (input.folders !== undefined) set.folders = input.folders;
    if (input.writeBack !== undefined) set.writeBack = input.writeBack;
    if (input.status !== undefined) set.status = input.status;
    if (input.password !== undefined) {
      set.secretEnc = this.crypto.sealString(input.password);
      // A new password is the fix for auth_failed, so clear the failure with it.
      set.status = input.status ?? "ok";
      set.statusDetail = null;
    }

    const [updated] = await this.db.update(mailConnections).set(set).where(eq(mailConnections.id, id)).returning();
    if (!updated) throw new NotFoundException("mail connection not found");

    await this.audit.record({
      action: "mail_connection.update",
      actorUserId,
      entityType: "mail_connection",
      entityId: id,
      metadata: { fields: Object.keys(set).map((f) => (f === "secretEnc" ? "password" : f)) },
    });
    return toView(updated, null);
  }

  async remove(id: string, actorUserId: string): Promise<void> {
    const existing = await this.require(id);
    this.assertOwner(existing, actorUserId);
    await this.db.delete(mailConnections).where(eq(mailConnections.id, id));
    await this.audit.record({ action: "mail_connection.delete", actorUserId, entityType: "mail_connection", entityId: id, metadata: { emailAddress: existing.emailAddress } });
  }

  /**
   * Try the credentials and report what a person can act on (§7.3 step 3). Runs in `mailfetch`,
   * never in the API: this is the only place a stored app password is unsealed, and the API has
   * no route to an IMAP host anyway (§3.6).
   */
  async test(config: MailSourceConfig, make: (c: MailSourceConfig) => MailSource = (c) => new ImapSource(c)): Promise<TestOutcome> {
    const source = make(config);
    try {
      await source.connect();
      const folders = await source.listFolders();
      return { ok: true, folders, problem: null, hint: null };
    } catch (err) {
      const { problem, hint } = explain(err as Error, config);
      this.log.warn(`connection test for ${config.username}@${config.host} failed: ${problem}`);
      return { ok: false, folders: [], problem, hint };
    } finally {
      await source.close().catch(() => undefined);
    }
  }

  /**
   * Test a stored connection and write the answer where it belongs: onto the connection itself.
   * The hint is folded into `statusDetail` because a failure the user cannot act on is barely
   * better than no message at all.
   */
  async testConnection(connectionId: string, make?: (c: MailSourceConfig) => MailSource): Promise<TestOutcome> {
    const outcome = await this.test(await this.configFor(connectionId), make);
    if (outcome.ok) {
      const now = new Date();
      await this.db
        .update(mailConnections)
        .set({ status: "ok", statusDetail: null, discoveredFolders: outcome.folders, lastOkAt: now, lastCheckedAt: now })
        .where(eq(mailConnections.id, connectionId));
      // Success was silent before: pressing Test printed nothing, so a working connection and a
      // job that never ran looked identical in the log.
      this.log.log(`connection ${connectionId} tested ok · ${outcome.folders.length} folders worth filing from`);
    } else {
      const status = /rejected the username or password/.test(outcome.problem ?? "") ? "auth_failed" : "unreachable";
      const detail = [outcome.problem, outcome.hint].filter(Boolean).join(" ");
      // `lastCheckedAt` moves on a failure too. A test that fails the same way twice changes
      // nothing else on the row, and the page has no other way to know its answer came back.
      await this.db
        .update(mailConnections)
        .set({ status, statusDetail: detail, lastCheckedAt: new Date() })
        .where(eq(mailConnections.id, connectionId));
    }
    return outcome;
  }

  /** Credentials for the fetcher. The only path by which a stored password is ever unsealed. */
  async configFor(id: string): Promise<MailSourceConfig> {
    const row = await this.require(id);
    return {
      host: row.imapHost,
      port: row.imapPort,
      username: row.imapUsername,
      password: this.crypto.openString(row.secretEnc),
    };
  }

  /** Recorded on every sync so a dead connection is visible rather than silent (§7.10). */
  async recordStatus(id: string, status: "ok" | "auth_failed" | "unreachable", detail: string | null): Promise<void> {
    const now = new Date();
    await this.db
      .update(mailConnections)
      .set({ status, statusDetail: detail, lastSyncAt: now, lastCheckedAt: now, ...(status === "ok" ? { lastOkAt: now } : {}) })
      .where(eq(mailConnections.id, id));
  }

  private async require(id: string) {
    const row = await this.db.select().from(mailConnections).where(eq(mailConnections.id, id)).limit(1).then((r) => r[0]);
    if (!row) throw new NotFoundException("mail connection not found");
    return row;
  }

  /**
   * The vault is shared and has no roles, but a mailbox credential is one person's (§7.7). Anyone
   * may see that a connection exists; only its owner may change or remove it.
   */
  private assertOwner(row: { ownerUserId: string }, actorUserId: string): void {
    if (row.ownerUserId !== actorUserId) throw new ForbiddenException("Only the owner of a mail connection can change it.");
  }
}

/**
 * IMAP servers report failure in their own dialects. These are the three a person can actually do
 * something about, and each hint is the sentence that saves a support round-trip (§7.3 step 3).
 */
export interface TestOutcome {
  ok: boolean;
  folders: string[];
  problem: string | null;
  hint: string | null;
}

export function explain(err: Error, config: MailSourceConfig): { problem: string; hint: string | null } {
  const message = err.message ?? String(err);
  const code = (err as NodeJS.ErrnoException).code;

  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication failed/i.test(message)) {
    return {
      problem: `${config.host} rejected the username or password.`,
      hint: /gmail|google/i.test(config.host)
        ? "Gmail needs an app password, not your account password — and app passwords only appear once 2-Step Verification is switched on."
        : "Most providers need an app password here rather than your account password.",
    };
  }
  if (/did not negotiate TLS/i.test(message)) {
    return { problem: message, hint: "Use port 993, or a server that offers STARTTLS. The vault will not send a password in cleartext." };
  }
  if (code === "ENOTFOUND" || /getaddrinfo/i.test(message)) {
    return { problem: `${config.host} could not be resolved.`, hint: "Check the server name — a typo here is the usual cause." };
  }
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || /timeout/i.test(message)) {
    return { problem: `${config.host}:${config.port} did not answer.`, hint: "Check the port, and that this machine is allowed to reach it." };
  }
  if (/certificate|self.signed|CERT_/i.test(message)) {
    return {
      problem: `${config.host} presented a certificate that could not be verified.`,
      hint: "For a self-hosted server or Proton Bridge, point NODE_EXTRA_CA_CERTS on the mailfetch container at its CA.",
    };
  }
  return { problem: message, hint: null };
}

function toView(row: typeof mailConnections.$inferSelect, ownerName: string | null): MailConnectionView {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    ownerName,
    label: row.label,
    emailAddress: row.emailAddress,
    providerHint: row.providerHint,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    imapUsername: row.imapUsername,
    scopeMode: row.scopeMode,
    folders: row.folders,
    discoveredFolders: row.discoveredFolders,
    writeBack: row.writeBack,
    retentionDays: row.retentionDays,
    isForwardingMailbox: row.kind === "forwarding",
    backfillStartedAt: row.backfillStartedAt?.toISOString() ?? null,
    backfillCompletedAt: row.backfillCompletedAt?.toISOString() ?? null,
    backfillTruncated: row.backfillTruncated,
    backfillMonths: row.backfillMonths,
    status: row.status,
    statusDetail: row.statusDetail,
    lastOkAt: row.lastOkAt?.toISOString() ?? null,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
