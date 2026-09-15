import { z } from "zod/v4";

/**
 * Sharing — handing documents to an outsider (spec §10).
 *
 * The one feature that needs a stranger's browser to reach something, which is why almost
 * everything here is shaped by *who serves the bytes*: every control a share offers is a promise
 * kept by the sink, and the two sinks cannot keep the same set.
 */

/**
 * Where a share's sealed bundle is served from.
 *
 * `doorman` — the harbor-share container on the owner's own box, behind Tailscale Funnel. All
 *   four controls work. The link is dead while the box is asleep, rebooting, or waiting on
 *   `harbor unlock`.
 * `bucket`  — pushed to the owner's own S3-compatible store. Survives the box being off and needs
 *   no inbound path at all, at the cost of one-time downloads and the longest expiry.
 */
export const ShareDelivery = z.enum(["doorman", "bucket"]);
export type ShareDelivery = z.infer<typeof ShareDelivery>;

export const SHARE_DELIVERY_LABEL: Record<ShareDelivery, string> = {
  doorman: "Served by Harbor",
  bucket: "Pushed to your storage",
};

/**
 * What each sink can actually promise. Not a preference table — a capability one. The interface
 * reads this rather than hard-coding the difference in three places, and says *why* a control is
 * missing instead of greying it out in silence.
 */
export interface SinkCapabilities {
  /** Counting completed downloads needs a stateful server; a presigned URL is not one. */
  maxDownloads: boolean;
  /** Longest expiry the sink can keep. Presigned URLs are valid for at most seven days. */
  maxExpiryHours: number;
  /**
   * `server` — the doorman checks it, rate-limited, and refuses the download.
   * `wrapped` — with nothing to ask, the password instead wraps the key in the link fragment and
   *   the recipient's browser unwraps it. Offline-brute-forceable by whoever holds the ciphertext,
   *   so the KDF is deliberately expensive and the wording promises less.
   */
  password: "server" | "wrapped";
  /** True when a share stops working while the appliance is off. */
  needsBoxOnline: boolean;
}

export const SINK_CAPABILITIES: Record<ShareDelivery, SinkCapabilities> = {
  doorman: { maxDownloads: true, maxExpiryHours: 720, password: "server", needsBoxOnline: true },
  bucket: { maxDownloads: false, maxExpiryHours: 168, password: "wrapped", needsBoxOnline: false },
};

/** One line, in the recipient's terms, for what choosing this sink costs or buys. */
export const SINK_CONSEQUENCE: Record<ShareDelivery, string> = {
  doorman: "Works only while your Harbor is awake. Can be limited to a single download.",
  bucket: "Works even if your Harbor is offline. Cannot be limited to a single download, and lasts at most 7 days.",
};

export const SHARE_EXPIRY_OPTIONS = [
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
] as const;

export type ShareExpiryHours = (typeof SHARE_EXPIRY_OPTIONS)[number]["hours"];

export function expiryOptionsFor(delivery: ShareDelivery) {
  const max = SINK_CAPABILITIES[delivery].maxExpiryHours;
  return SHARE_EXPIRY_OPTIONS.filter((o) => o.hours <= max);
}

/**
 * Bundles are padded up to one of these before they leave, because both the doorman and the store
 * see sizes and an unpadded one separates a passport scan from a year of tax paperwork (§10.10).
 * Past the largest bucket, round up to a whole multiple of it — a 900 MB bundle is conspicuous
 * whatever we do, and inflating it to 2 GB would cost the recipient more than it hides.
 */
export const SHARE_PAD_BUCKETS = [1, 4, 16, 64, 256].map((mb) => mb * 1024 * 1024);

export function paddedSizeFor(byteSize: number): number {
  const largest = SHARE_PAD_BUCKETS[SHARE_PAD_BUCKETS.length - 1];
  const bucket = SHARE_PAD_BUCKETS.find((b) => byteSize <= b);
  return bucket ?? Math.ceil(byteSize / largest) * largest;
}

/**
 * A recipient gets their own token, never a shared link with a password (§10.4) — that is what
 * makes the audit trail say *which* of them opened it, and lets one be cut off without breaking
 * the other. The name is a label the owner chose, not identity Harbor can verify.
 */
export const ShareRecipientInput = z.object({
  label: z.string().trim().min(1, "Give the recipient a name").max(120),
  password: z.string().min(6, "A password worth setting is at least 6 characters").max(200).optional(),
  /** Omit for unlimited. Rejected outright on a sink that cannot count. */
  maxDownloads: z.number().int().min(1).max(100).optional(),
});
export type ShareRecipientInput = z.infer<typeof ShareRecipientInput>;

/**
 * Documents only — an item may not be shared, not even as a shortcut that expands to the
 * documents filed under it (§10.5). Sharing "the car" and sharing four documents are different
 * promises, and the difference is invisible at the moment of sending.
 */
/**
 * Note what is **not** here: which sink serves the share.
 *
 * That is resolved on the server from a setting, and was deliberately taken out of this input
 * (2026-09-14). Choosing a delivery carries a setup requirement — a bucket and its credentials —
 * so it belongs in Settings, once, and not in front of someone who is trying to send four
 * documents. What the review screen does with it is state the consequence in a line.
 */
export const CreateShareInput = z.object({
  label: z.string().trim().min(1, "Name the share so you can find it later").max(200),
  message: z.string().trim().max(1000).optional(),
  documentIds: z.array(z.uuid()).min(1, "A share needs at least one document").max(50),
  expiryHours: z.number().int().positive(),
  recipients: z.array(ShareRecipientInput).min(1, "A share needs at least one recipient").max(20),
});
export type CreateShareInput = z.infer<typeof CreateShareInput>;

/** What the review screen needs to know before it draws its controls. */
export const ShareDeliverySettings = z.object({
  delivery: ShareDelivery,
  /** False when `bucket` is chosen but no usable bucket is configured; sharing is then blocked. */
  ready: z.boolean(),
  /** Why it is not ready, in the owner's terms. */
  problem: z.string().nullable(),
  /**
   * Whether the doorman answers anywhere but the box it runs on.
   *
   * False until `harbor public enable` has been run: until then the doorman is bound to
   * 127.0.0.1 and a share link reaches nobody, not even someone on the tailnet. Reported whatever
   * the chosen sink is, because Settings draws both options and has to describe the one that is
   * not selected honestly — a badge reading "nothing to set up" beside a sink that needs a command
   * run on the box is the first thing anyone reads and the last thing they check (2026-09-15).
   *
   * Not folded into `ready`, which blocks sharing. An unpublished doorman still seals the bundle
   * and still mints a valid link; what is missing is reachability, and it is restored by one
   * command without invalidating anything already made. So this warns and does not stop.
   */
  doormanPublished: z.boolean(),
  /** Where the doorman answers, once it is published. For showing the name it took. */
  doormanOrigin: z.string(),
});
export type ShareDeliverySettings = z.infer<typeof ShareDeliverySettings>;

export const SetShareDelivery = z.object({ delivery: ShareDelivery });
export type SetShareDelivery = z.infer<typeof SetShareDelivery>;

/** What the doorman reports. `denied` carries a reason the fetcher was never told (§10.6). */
export const ShareAccessEvent = z.enum(["viewed", "password_failed", "download_started", "download_completed", "denied"]);
export type ShareAccessEvent = z.infer<typeof ShareAccessEvent>;

export const SHARE_EVENT_LABEL: Record<ShareAccessEvent, string> = {
  viewed: "Opened the page",
  password_failed: "Wrong password",
  download_started: "Started downloading",
  download_completed: "Downloaded",
  denied: "Turned away",
};

/**
 * A share's state, derived rather than stored — four columns already say it, and a fifth that
 * could disagree with them would be worse than a computed answer.
 */
export const ShareStatus = z.enum(["active", "expired", "revoked"]);
export type ShareStatus = z.infer<typeof ShareStatus>;

export function shareStatus(share: { expiresAt: Date | string; revokedAt?: Date | string | null }, now = new Date()): ShareStatus {
  if (share.revokedAt) return "revoked";
  return new Date(share.expiresAt).getTime() <= now.getTime() ? "expired" : "active";
}

/**
 * Names inside the zip. Sanitised and de-duplicated at seal time rather than trusted from
 * `original_filename`: two files called "Rechnung.pdf" is the ordinary case, and a name carrying
 * a path separator or a leading dot is how an archive escapes the directory it was opened in.
 */
export function bundleFilenames(files: { title: string; originalFilename?: string | null }[]): string[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const source = f.originalFilename?.trim() || `${f.title}.pdf`;
    const base = source
      .replace(/[/\\]/g, "-")
      .replace(/^[.\s]+/, "")
      .replace(/[\x00-\x1f]/g, "")
      .slice(0, 120)
      .trim();
    const safe = base || "document.pdf";
    const n = seen.get(safe.toLowerCase()) ?? 0;
    seen.set(safe.toLowerCase(), n + 1);
    if (n === 0) return safe;
    const dot = safe.lastIndexOf(".");
    return dot > 0 ? `${safe.slice(0, dot)} (${n + 1})${safe.slice(dot)}` : `${safe} (${n + 1})`;
  });
}
