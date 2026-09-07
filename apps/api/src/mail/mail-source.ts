/**
 * What the vault needs from a mailbox, and nothing more (spec §7.2). IMAP is the only v1
 * implementation; JMAP would land here beside it rather than as a second ingestion path.
 *
 * The shape is deliberately envelope-first. `scan` yields headers and a parts manifest — no body
 * has been downloaded at that point — and `download` is a separate, explicit act for one part of
 * one message. That is what lets §7.5 decide on a message without reading it.
 */
export interface MailSource {
  readonly kind: string;
  connect(): Promise<void>;
  close(): Promise<void>;
  /** Folder names as the server reports them, minus ones no one files from (Trash, Spam, Drafts). */
  listFolders(): Promise<string[]>;
  /** UIDVALIDITY for a folder. A change means the server renumbered and UIDs must not be trusted. */
  openFolder(folder: string): Promise<{ uidValidity: number; exists: number }>;
  scan(folder: string, opts?: ScanOptions): AsyncIterable<MailEnvelope>;
  download(folder: string, uid: number, part: string): Promise<Buffer>;
}

export interface ScanOptions {
  /** Server-side date filter — the mailbox does the narrowing, not us. */
  since?: Date;
  /** Only messages numbered above this, for a resync that does not re-read the mailbox. */
  sinceUid?: number;
}

export interface MailEnvelope {
  uid: number;
  /** Stable across folders and renumbering; the idempotency key (§7.5). Synthesised if absent. */
  messageId: string;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  date: Date;
  /** Every leaf part, from BODYSTRUCTURE alone. Nothing here cost a body download. */
  parts: MailPart[];
}

export interface MailPart {
  /** IMAP part path — "1", "2.1" — passed back to `download`. */
  part: string;
  filename: string | null;
  mimeType: string;
  /** Bytes as the server reports them, before decoding. Good enough for the caps in §7.5. */
  size: number;
  /** `attachment` or `inline`; absent on the body parts of a plain message. */
  disposition: string | null;
  /** Content-ID. Present when the HTML body references this part as `cid:…` — decoration, not post. */
  contentId: string | null;
}

/** Credentials for one connection. Always an app password — there is no OAuth in v1 (§7.2). */
export interface MailSourceConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export const ATTACHABLE_MIME = /^(application\/pdf|image\/(jpeg|png|heic|heif|tiff|webp))$/i;

/**
 * Mailboxes nobody files paperwork out of. Special-use flags first, because a server that sets
 * them is telling the truth in any language; names second, for the servers that do not.
 *
 * Names are matched after stripping spaces and punctuation. A real Gmail account turned up
 * "Junk E-mail" — an Outlook-era name Gmail never flags — and an exact-match list let it through
 * to the backfill, which reads every folder. Comparing "junkemail" catches that whole family
 * ("Deleted Items", "Junk E-Mail", "Gelöschte Elemente") without resorting to a substring test
 * that would also swallow "Junk Removal Invoices".
 */
const SKIP_FLAGS = new Set(["\\Trash", "\\Junk", "\\Drafts", "\\All", "\\Sent"]);
const SKIP_NAMES = new Set([
  "trash",
  "junk",
  "junkemail",
  "junkmail",
  "spam",
  "bulkmail",
  "drafts",
  "draft",
  // Sent mail is paperwork you sent someone else. Filing your own outgoing attachments makes you
  // the top "sender" in the review, which is how this was found — on a real mailbox.
  "sent",
  "sentmail",
  "sentitems",
  "sentmessages",
  "outbox",
  "gesendet",
  "gesendeteelemente",
  "gesendeteobjekte",
  "postausgang",
  "bin",
  "deleteditems",
  "deletedmessages",
  "deleted",
  // German, since the vault is bilingual everywhere else (§5).
  "papierkorb",
  "entwürfe",
  "entwuerfe",
  "gelöschteelemente",
  "geloeschteelemente",
  "gelöschteobjekte",
  "werbung",
]);

export function isFilableFolder(folder: { path: string; name?: string; specialUse?: string }): boolean {
  if (folder.specialUse && SKIP_FLAGS.has(folder.specialUse)) return false;
  const leaf = folder.name ?? folder.path.split(/[/.]/).pop() ?? "";
  return !SKIP_NAMES.has(normaliseFolderName(leaf));
}

/** Lowercase and drop the separators folder names differ by: "Junk E-mail" → "junkemail". */
export function normaliseFolderName(name: string): string {
  return name.toLowerCase().replace(/[\s._\-'’]/g, "");
}

/**
 * Flatten a BODYSTRUCTURE tree into its leaf parts. Multipart nodes are structure, not content,
 * so only leaves come back. ImapFlow numbers every node for us; a single-part message has no
 * number of its own and is part "1".
 */
export function flattenParts(node: BodyStructureNode | undefined): MailPart[] {
  if (!node) return [];
  if (node.childNodes?.length) return node.childNodes.flatMap((child) => flattenParts(child));
  return [
    {
      part: node.part ?? "1",
      filename: node.dispositionParameters?.filename ?? node.parameters?.name ?? null,
      mimeType: (node.type ?? "application/octet-stream").toLowerCase(),
      size: node.size ?? 0,
      disposition: node.disposition ?? null,
      contentId: node.id ?? null,
    },
  ];
}

export interface BodyStructureNode {
  part?: string;
  type?: string;
  size?: number;
  /** Content-ID, as ImapFlow reports it. */
  id?: string | null;
  disposition?: string | null;
  parameters?: { name?: string };
  dispositionParameters?: { filename?: string };
  childNodes?: BodyStructureNode[];
}
