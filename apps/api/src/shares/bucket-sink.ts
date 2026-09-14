import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFile } from "node:fs/promises";
import type { Env } from "../config/env";
import type { ShareSink } from "./share-sink";
import { MAX_PRESIGN_SECONDS, presignGet, signDelete, signPut, type S3Credentials } from "./sigv4";
import { landingPage } from "./landing-page";

/**
 * The second sink: the owner's own object store (spec §10.10).
 *
 * Two objects per share, in **one bucket** so the page fetches the bundle same-origin and no CORS
 * rule has to be asked of the owner:
 *
 *   <prefix>/<share_id>/bundle       the sealed archive, padded
 *   <prefix>/<share_id>/index.html   a per-share page with the bundle's signed URL baked in
 *
 * The link handed to the recipient is a signed URL for the page, with the key in the fragment —
 * which browsers never transmit, so the store holds ciphertext it cannot read. The box only ever
 * makes an outbound PUT: there is no inbound path to the appliance on this sink at all, and an
 * install that uses it needs no Funnel and no change to the §3.1 threat model.
 *
 * A separate, private bucket from the restic one, by decision (§10.10): a lifecycle rule that is
 * right for share objects is wrong for backup data, and a prefix anonymous requests can reach has
 * no business inside the bucket holding the vault's last line of defence.
 */
@Injectable()
export class BucketSink implements ShareSink {
  readonly kind = "bucket" as const;
  private readonly log = new Logger(BucketSink.name);
  private readonly creds: S3Credentials | null;
  private readonly prefix: string;

  constructor(config: ConfigService<Env, true>) {
    const endpoint = config.get("SHARE_BUCKET_ENDPOINT", { infer: true });
    const bucket = config.get("SHARE_BUCKET", { infer: true });
    const accessKeyId = config.get("SHARE_BUCKET_KEY_ID", { infer: true });
    const secretAccessKey = config.get("SHARE_BUCKET_SECRET", { infer: true });
    this.prefix = config.get("SHARE_BUCKET_PREFIX", { infer: true });
    this.creds =
      endpoint && accessKeyId && secretAccessKey
        ? { endpoint, bucket: bucket ?? "", accessKeyId, secretAccessKey, region: config.get("SHARE_BUCKET_REGION", { infer: true }) }
        : null;
  }

  get configured(): boolean {
    return this.creds !== null;
  }

  /**
   * Push a sealed bundle and its page, and return the link.
   *
   * `expiresInSeconds` is capped by the protocol at seven days, which is why `bucket` delivery
   * offers no 30-day expiry — the interface says so rather than producing a link that dies on day
   * eight (§10.10).
   */
  async publish(opts: {
    shareId: string;
    sealedPath: string;
    filename: string;
    fileCount: number;
    message: string | null;
    expiresAt: Date;
    expiresInSeconds: number;
  }): Promise<{ objectKey: string; pageUrl: string }> {
    const creds = this.requireCreds();
    if (opts.expiresInSeconds > MAX_PRESIGN_SECONDS) {
      throw new Error("A link served from your own storage cannot last longer than 7 days.");
    }

    const objectKey = `${this.prefix}/${opts.shareId}`;
    const bundleKey = `${objectKey}/bundle`;
    const pageKey = `${objectKey}/index.html`;

    // The bundle is read whole to be signed: SigV4 hashes the body, which is what makes a mangled
    // upload fail rather than sit there as a share nobody can open. Bundles are capped well below
    // the size where that is a problem, and a multipart upload would trade that guarantee away.
    const body = await readFile(opts.sealedPath);
    await this.send("PUT", signPut(creds, bundleKey, body, "application/octet-stream"), body, `bundle for ${opts.shareId}`);

    const bundleUrl = presignGet(creds, bundleKey, opts.expiresInSeconds);
    const page = Buffer.from(
      landingPage({
        bundleUrl,
        filename: opts.filename,
        fileCount: opts.fileCount,
        message: opts.message,
        expiresAt: opts.expiresAt.toISOString(),
      }),
      "utf8",
    );
    await this.send("PUT", signPut(creds, pageKey, page, "text/html; charset=utf-8"), page, `page for ${opts.shareId}`);

    return { objectKey, pageUrl: presignGet(creds, pageKey, opts.expiresInSeconds) };
  }

  /** Withdrawing a share from the store. The link stops resolving because the bytes are gone. */
  async remove(objectKey: string): Promise<void> {
    const creds = this.requireCreds();
    for (const key of [`${objectKey}/bundle`, `${objectKey}/index.html`]) {
      try {
        await this.send("DELETE", signDelete(creds, key), undefined, `delete ${key}`);
      } catch (err) {
        // Worth shouting about: an object outliving its share is the whole exposure (§10.7).
        this.log.error(`Could not delete ${key} from the share bucket: ${(err as Error).message}`);
        throw err;
      }
    }
  }

  private requireCreds(): S3Credentials {
    if (!this.creds) {
      throw new Error("No share bucket is configured. Set SHARE_BUCKET_ENDPOINT, SHARE_BUCKET_KEY_ID and SHARE_BUCKET_SECRET.");
    }
    return this.creds;
  }

  private async send(
    method: "PUT" | "DELETE",
    req: { url: string; headers: Record<string, string> },
    body: Buffer | undefined,
    what: string,
  ): Promise<void> {
    const res = await fetch(req.url, { method, headers: req.headers, body });
    if (!res.ok) {
      // The store's own message is worth keeping: "SignatureDoesNotMatch" and "NoSuchBucket" want
      // very different fixes, and a bare status tells the owner neither.
      const detail = await res.text().catch(() => "");
      throw new Error(`${what}: the store answered ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
    }
  }
}
