import { ATTACHABLE_MIME, type MailEnvelope, type MailPart } from "./mail-source";

/**
 * Which messages are worth a body download, decided from the envelope and the parts manifest
 * alone (spec §7.5). Nothing here reaches the network, and nothing here reaches a model — the
 * classification tier was cut deliberately, so a personal inbox is read only by this file.
 *
 * **An attachment is enough.** This used to hold mail from any sender you had not approved, which
 * sounded careful and was not: an allowlist can only admit relationships you already have, so the
 * new billing relationship — the thing you most want caught — was exactly what it blocked. And
 * the vault already has a review queue for "this arrived, decide what it is": the Inbox. Holding
 * mail in a second queue in Settings meant two queues for one job, and the one people actually
 * look at was not the one the post was sitting in.
 *
 * So a real attachment files itself, and sender rules do the two jobs they are good at:
 *   - `ignore` mutes a sender, set when you delete something they sent
 *   - `file` carries a category and item, set when you accept a suggestion on their post
 *
 * Both are learned from decisions you were making anyway, rather than asked for upfront.
 *
 * The asymmetry is the argument: a false positive costs one dismissed Inbox card; a false
 * negative means an invoice sits in a queue nobody opens and the feature quietly does nothing.
 */

export interface SenderRule {
  decision: "file" | "ignore" | "hold";
  defaultCategorySlug: string | null;
  defaultItemLabels: string[];
  defaultTags: string[];
}

export interface DetectionCaps {
  maxAttachmentBytes: number;
  maxAttachments: number;
}

/** §7.5. Deliberately const rather than configurable: a cap you can raise is a cap you will raise. */
export const DEFAULT_CAPS: DetectionCaps = { maxAttachmentBytes: 25 * 1024 * 1024, maxAttachments: 10 };

export interface Detection {
  decision: "file" | "hold" | "ignore";
  /** Which tier decided, for `email_ingest_log.tier`. Null when nothing matched. */
  tier: number | null;
  /** Why, in the words the held-mail screen shows. Null when filed. */
  reason: string | null;
  /** The parts worth downloading. Empty for a body-only message, which §7.9 handles separately. */
  attachments: MailPart[];
  rule: SenderRule | null;
}

/**
 * Paperwork words in both languages. Matched against the subject and every filename, because a
 * German invoice from an English-language sender is exactly the case §5's aliases exist for.
 */
const PAPERWORK = new RegExp(
  [
    "rechnung", "beleg", "quittung", "zahlungsbest", "mahnung", "kontoauszug", "vertrag",
    "bescheinigung", "police", "versicherungsschein", "steuerbescheid", "gebührenbescheid",
    "invoice", "receipt", "statement", "bill", "policy", "contract", "confirmation",
    "remittance", "tax", "premium",
  ].join("|"),
  "i",
);

export function detect(envelope: MailEnvelope, rule: SenderRule | null, caps: DetectionCaps = DEFAULT_CAPS): Detection {
  const attachments = filableAttachments(envelope.parts);

  // A mute is a decision someone already made, and it outranks what the mail looks like.
  if (rule?.decision === "ignore") return { decision: "ignore", tier: 2, reason: "sender is muted", attachments: [], rule };

  // Caps are the only reason left to hold: too big or too many is a case for a person, not a rule.
  const oversized = attachments.find((a) => a.size > caps.maxAttachmentBytes);
  if (oversized) {
    return {
      decision: "hold",
      tier: 2,
      reason: `${oversized.filename ?? "an attachment"} is ${Math.round(oversized.size / 1024 / 1024)} MB, over the ${Math.round(caps.maxAttachmentBytes / 1024 / 1024)} MB limit`,
      attachments: [],
      rule,
    };
  }
  if (attachments.length > caps.maxAttachments) {
    return { decision: "hold", tier: 2, reason: `${attachments.length} attachments, over the limit of ${caps.maxAttachments}`, attachments: [], rule };
  }

  // An attachment is enough. Tier 2 when a rule also says where it goes, tier 0 when the parts
  // manifest alone decided — the distinction is only for the log.
  if (attachments.length) {
    return { decision: "file", tier: rule?.decision === "file" ? 2 : 0, reason: null, attachments, rule };
  }

  // Nothing attached: there is no document here. `Your invoice is ready — log in` is a reminder,
  // not a file, and it waits for §7.9's card state rather than cluttering a queue in the meantime.
  return { decision: "ignore", tier: null, reason: null, attachments: [], rule };
}

/**
 * Attachments, and only attachments (§2 stage 1).
 *
 * The first version of this accepted any part with a filename, on the assumption that embedded
 * images do not have one. On a real mailbox that produced an Inbox full of `image001.png` —
 * Outlook names every image in an HTML body that way, signature logos and social icons included,
 * and gives each one a filename. So a filename proves nothing.
 *
 * What does distinguish them is how the body refers to the part: an embedded image is marked
 * `inline`, carries a Content-ID, or both, because the HTML has to point at it. An attachment is
 * something the sender deliberately added.
 */
export function filableAttachments(parts: MailPart[]): MailPart[] {
  return parts.filter(isAttachment);
}

function isAttachment(part: MailPart): boolean {
  if (!ATTACHABLE_MIME.test(part.mimeType)) return false;

  // Referenced from the HTML body as `cid:…`, or explicitly drawn in it. Decoration either way,
  // whatever it is called and however large it is — a 4 MB photo pasted into a body is still not
  // an attachment someone chose to send.
  if (part.contentId) return false;
  if (part.disposition?.toLowerCase() === "inline") return false;

  if (part.disposition?.toLowerCase() === "attachment") return true;

  // Some mailers send no disposition at all. A named PDF is unambiguous even then; a bare image
  // is not, and images are what this rule exists to keep out. Phone scans arrive from a share
  // sheet, which always marks them as attachments, so nothing real is lost here.
  return Boolean(part.filename) && !part.mimeType.startsWith("image/");
}

/** Unused by `detect` since attachments became the whole test. Kept for §7.9's fetch reminders. */
export function looksLikePaperwork(envelope: MailEnvelope): boolean {
  if (envelope.subject && PAPERWORK.test(envelope.subject)) return true;
  return envelope.parts.some((p) => p.filename && PAPERWORK.test(p.filename));
}
