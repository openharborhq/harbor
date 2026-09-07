import { Logger } from "@nestjs/common";
import { ImapFlow, type FetchMessageObject, type ListResponse } from "imapflow";
import {
  flattenParts,
  isFilableFolder,
  type BodyStructureNode,
  type MailEnvelope,
  type MailSource,
  type MailSourceConfig,
  type ScanOptions,
} from "./mail-source";

/**
 * IMAP over TLS with an app password (spec §7.2). Outbound only: nothing is exposed, nothing is
 * forwarded, and a mailbox behind NAT works exactly as one on a public host does.
 *
 * Plaintext is refused with no override. Port 993 is implicit TLS; anything else must negotiate
 * STARTTLS or the connection fails. A private CA belongs in NODE_EXTRA_CA_CERTS on the mailfetch
 * container, not in the database — it is a property of the host, not of the connection.
 */
export class ImapSource implements MailSource {
  readonly kind = "imap";
  private readonly log = new Logger(ImapSource.name);
  private client: ImapFlow | null = null;
  private openFolderName: string | null = null;

  constructor(private readonly config: MailSourceConfig) {}

  async connect(): Promise<void> {
    const implicitTls = this.config.port === 993;
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      // false does not mean cleartext: ImapFlow upgrades with STARTTLS when the server offers it.
      secure: implicitTls,
      auth: { user: this.config.username, pass: this.config.password },
      logger: false,
      emitLogs: false,
      // A backfill downloads and files between fetches, so the socket sits idle for stretches at
      // a time. The default cuts it off mid-pass; ten minutes covers the slowest attachment.
      socketTimeout: 10 * 60_000,
      connectionTimeout: 30_000,
      greetingTimeout: 20_000,
    });

    /**
     * ImapFlow is an EventEmitter, and an `error` event with no listener is a process-level throw
     * in Node — it does not reach the try/catch around whatever call was in flight. A socket
     * timeout during a backfill therefore killed the whole mailfetch service, taking the sweep for
     * every other connection with it and leaving the scan half-finished.
     *
     * Listening turns that back into an ordinary failed operation: the in-flight call rejects, the
     * caller records the connection as unreachable, and the next pass picks up from the cursor.
     */
    client.on("error", (err: Error) => {
      this.log.warn(`${this.config.host}: connection dropped — ${err.message}`);
    });

    await client.connect();

    // Checked rather than requested: this asserts TLS actually happened, instead of trusting an
    // option and a well-behaved server. A mailbox reachable only in cleartext is not usable here.
    if (!client.secureConnection) {
      client.close();
      throw new Error(`${this.config.host}:${this.config.port} did not negotiate TLS — refusing to send an app password in cleartext`);
    }
    this.client = client;
  }

  async close(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.logout();
    } catch {
      this.client.close();
    }
    this.client = null;
    this.openFolderName = null;
  }

  async listFolders(): Promise<string[]> {
    const folders = await this.require().list();
    return folders
      .filter((f: ListResponse) => !f.flags?.has("\\Noselect"))
      .filter((f) => isFilableFolder({ path: f.path, name: f.name, specialUse: f.specialUse }))
      .map((f) => f.path);
  }

  async openFolder(folder: string): Promise<{ uidValidity: number; exists: number }> {
    // readOnly issues EXAMINE rather than SELECT: opening a folder must not change anything in it.
    const mailbox = await this.require().mailboxOpen(folder, { readOnly: true });
    this.openFolderName = folder;
    return { uidValidity: Number(mailbox.uidValidity), exists: mailbox.exists };
  }

  /**
   * Envelopes and BODYSTRUCTURE only — the manifest, never the content. A 300-message folder
   * costs a few hundred KB here, and §7.5 decides from that alone whether a body is worth fetching.
   */
  async *scan(folder: string, opts: ScanOptions = {}): AsyncIterable<MailEnvelope> {
    const client = this.require();
    if (this.openFolderName !== folder) await this.openFolder(folder);

    const range = opts.sinceUid ? `${opts.sinceUid + 1}:*` : "1:*";
    const query = opts.since ? { uid: range, since: opts.since } : { uid: range };

    for await (const message of client.fetch(query, { uid: true, envelope: true, bodyStructure: true }, { uid: true })) {
      const envelope = toEnvelope(message, folder);
      // A UID range starting past the end comes back as the last message; drop that overlap.
      if (opts.sinceUid && envelope.uid <= opts.sinceUid) continue;
      yield envelope;
    }
  }

  async download(folder: string, uid: number, part: string): Promise<Buffer> {
    const client = this.require();
    if (this.openFolderName !== folder) await this.openFolder(folder);

    const result = await client.download(String(uid), part, { uid: true });
    if (!result?.content) throw new Error(`part ${part} of message ${uid} in ${folder} had no content`);

    const chunks: Buffer[] = [];
    for await (const chunk of result.content) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  private require(): ImapFlow {
    if (!this.client) throw new Error("ImapSource used before connect()");
    return this.client;
  }
}

/**
 * A Message-ID is the only identifier stable across folders and renumbering, so it is the
 * idempotency key (§7.5). Mail without one exists — some scanners and fax gateways omit it — and
 * gets a synthetic key derived from the fields that are present, stable for the same message.
 */
export function toEnvelope(message: FetchMessageObject, folder: string): MailEnvelope {
  const envelope = message.envelope;
  const from = envelope?.from?.[0];
  // Both fields are typed string | Date depending on the server's reply; normalise once.
  const rawDate = envelope?.date ?? message.internalDate;
  const date = rawDate ? new Date(rawDate) : new Date();
  const subject = envelope?.subject ?? null;
  const fromAddress = from?.address?.toLowerCase() ?? null;

  return {
    uid: message.uid,
    messageId: envelope?.messageId ?? synthesiseMessageId(folder, message.uid, fromAddress, subject, date),
    fromAddress,
    fromName: from?.name ?? null,
    subject,
    date,
    parts: flattenParts(message.bodyStructure as BodyStructureNode | undefined),
  };
}

function synthesiseMessageId(folder: string, uid: number, from: string | null, subject: string | null, date: Date): string {
  const basis = [folder, uid, from ?? "", subject ?? "", date.toISOString()].join(" ");
  return `<synthetic-${Buffer.from(basis).toString("base64url").slice(0, 48)}@harbor.local>`;
}
