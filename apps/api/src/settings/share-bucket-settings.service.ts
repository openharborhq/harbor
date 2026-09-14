import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import type { ShareBucketSettings, ShareBucketTestResult, ShareDelivery, ShareDeliverySettings, UpdateShareBucketSettings } from "@harbor/shared";
import type { Env } from "../config/env";
import { presignGet, signDelete, signPut, type S3Credentials } from "../shares/sigv4";
import { SETTING, SettingsService } from "./settings.service";

/**
 * The share bucket's configuration: what an owner saved, falling back to what the process was
 * started with (spec §10.10).
 *
 * Resolved on every use rather than at boot, like the suggestion provider — someone who has just
 * created a bucket in a web console should not then have to edit a file over ssh and restart a
 * container to use it. That was the whole objection to asking this audience to configure anything.
 */
@Injectable()
export class ShareBucketSettingsService {
  private readonly log = new Logger(ShareBucketSettingsService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async resolve(): Promise<{ creds: S3Credentials | null; prefix: string; fromEnvironment: boolean }> {
    const stored = await this.settings.getMany([
      SETTING.shareBucketEndpoint,
      SETTING.shareBucketName,
      SETTING.shareBucketRegion,
      SETTING.shareBucketKeyId,
      SETTING.shareBucketSecret,
      SETTING.shareBucketPrefix,
    ]);
    const endpoint = stored.get(SETTING.shareBucketEndpoint) ?? this.config.get("SHARE_BUCKET_ENDPOINT", { infer: true }) ?? null;
    const accessKeyId = stored.get(SETTING.shareBucketKeyId) ?? this.config.get("SHARE_BUCKET_KEY_ID", { infer: true }) ?? null;
    const secretAccessKey = stored.get(SETTING.shareBucketSecret) ?? this.config.get("SHARE_BUCKET_SECRET", { infer: true }) ?? null;
    const prefix = stored.get(SETTING.shareBucketPrefix) ?? this.config.get("SHARE_BUCKET_PREFIX", { infer: true }) ?? "shares";

    return {
      prefix,
      fromEnvironment: stored.size === 0,
      creds:
        endpoint && accessKeyId && secretAccessKey
          ? {
              endpoint,
              bucket: stored.get(SETTING.shareBucketName) ?? this.config.get("SHARE_BUCKET", { infer: true }) ?? "",
              accessKeyId,
              secretAccessKey,
              region: stored.get(SETTING.shareBucketRegion) ?? this.config.get("SHARE_BUCKET_REGION", { infer: true }),
            }
          : null,
    };
  }

  /**
   * How every share on this install is delivered.
   *
   * `doorman` unless an owner has chosen otherwise, because it needs no setup: an install that has
   * never been configured can still share. Choosing `bucket` without a usable bucket is reported
   * as not ready rather than silently falling back — a share that quietly went out by a different
   * route than the owner chose would be worse than one that refuses.
   */
  async delivery(): Promise<ShareDeliverySettings> {
    const stored = await this.settings.getMany([SETTING.shareDelivery]);
    const chosen = (stored.get(SETTING.shareDelivery) as ShareDelivery | undefined) ?? "doorman";
    if (chosen !== "bucket") return { delivery: "doorman", ready: true, problem: null };
    const { creds } = await this.resolve();
    return creds
      ? { delivery: "bucket", ready: true, problem: null }
      : { delivery: "bucket", ready: false, problem: "Shares are set to go to your own storage, but no bucket is configured yet." };
  }

  async setDelivery(delivery: ShareDelivery): Promise<ShareDeliverySettings> {
    await this.settings.set(SETTING.shareDelivery, delivery);
    this.log.log(`shares will be delivered by ${delivery}`);
    return this.delivery();
  }

  /** For Settings. The secret never leaves the box, so only its presence is reported. */
  async view(): Promise<ShareBucketSettings> {
    const { creds, prefix, fromEnvironment } = await this.resolve();
    const stored = await this.settings.getMany([SETTING.shareBucketEndpoint, SETTING.shareBucketName, SETTING.shareBucketKeyId, SETTING.shareBucketRegion]);
    return {
      endpoint: creds?.endpoint ?? stored.get(SETTING.shareBucketEndpoint) ?? null,
      bucket: creds?.bucket || stored.get(SETTING.shareBucketName) || null,
      region: creds?.region ?? stored.get(SETTING.shareBucketRegion) ?? this.config.get("SHARE_BUCKET_REGION", { infer: true }),
      keyId: creds?.accessKeyId ?? stored.get(SETTING.shareBucketKeyId) ?? null,
      secretSet: Boolean(creds?.secretAccessKey),
      prefix,
      fromEnvironment,
      usable: creds !== null,
    };
  }

  async update(patch: UpdateShareBucketSettings): Promise<ShareBucketSettings> {
    if (patch.endpoint !== undefined) await this.settings.set(SETTING.shareBucketEndpoint, patch.endpoint || null);
    if (patch.bucket !== undefined) await this.settings.set(SETTING.shareBucketName, patch.bucket || null);
    if (patch.region !== undefined) await this.settings.set(SETTING.shareBucketRegion, patch.region || null);
    if (patch.keyId !== undefined) await this.settings.set(SETTING.shareBucketKeyId, patch.keyId || null);
    // Sealed under the KEK, like a mail password. An omitted secret keeps the stored one.
    if (patch.secret !== undefined) await this.settings.set(SETTING.shareBucketSecret, patch.secret || null, { secret: true });
    if (patch.prefix !== undefined) await this.settings.set(SETTING.shareBucketPrefix, patch.prefix || null);
    this.log.log("share bucket settings updated");
    return this.view();
  }

  /**
   * Write a small object, read it back through a signed URL, then delete it.
   *
   * Those are exactly the three things a share does, in the order it does them. A credential check
   * alone would pass on a bucket that cannot serve a presigned GET — which is the one capability
   * that makes a store a sink at all — and the owner would find that out from their accountant.
   */
  async test(): Promise<ShareBucketTestResult> {
    const { creds, prefix } = await this.resolve();
    if (!creds) return { ok: false, message: "Fill in the address, key and secret first.", step: "write" };

    const key = `${prefix}/.harbor-check-${randomBytes(8).toString("hex")}`;
    const body = Buffer.from(`harbor share bucket check ${new Date().toISOString()}\n`, "utf8");

    try {
      const put = signPut(creds, key, body, "text/plain");
      const res = await fetch(put.url, { method: "PUT", headers: put.headers, body });
      if (!res.ok) return { ok: false, step: "write", message: await explain(res, "Could not write to the bucket") };
    } catch (err) {
      return { ok: false, step: "write", message: `Could not reach the bucket: ${(err as Error).message}` };
    }

    try {
      const res = await fetch(presignGet(creds, key, 60));
      if (!res.ok) return { ok: false, step: "read", message: await explain(res, "Written, but a signed link could not read it back") };
      const back = Buffer.from(await res.arrayBuffer());
      if (!back.equals(body)) {
        return { ok: false, step: "read", message: "The bucket returned something other than what was written." };
      }
    } catch (err) {
      return { ok: false, step: "read", message: `A signed link could not read it back: ${(err as Error).message}` };
    }

    try {
      const del = signDelete(creds, key);
      const res = await fetch(del.url, { method: "DELETE", headers: del.headers });
      if (!res.ok) {
        // Worth failing on: a share that cannot be deleted cannot be withdrawn (§10.7).
        return { ok: false, step: "delete", message: await explain(res, "Written and read, but the test object could not be deleted") };
      }
    } catch (err) {
      return { ok: false, step: "delete", message: `The test object could not be deleted: ${(err as Error).message}` };
    }

    return { ok: true, step: "done", message: "Wrote a test file, read it back through a signed link, and deleted it." };
  }
}

/** The store's own words are worth keeping: "SignatureDoesNotMatch" and "NoSuchBucket" differ. */
async function explain(res: Response, prefix: string): Promise<string> {
  const body = await res.text().catch(() => "");
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
  const hint =
    code === "SignatureDoesNotMatch"
      ? " — the secret does not match the key id."
      : code === "NoSuchBucket"
        ? " — no bucket by that name at this address."
        : code === "InvalidAccessKeyId"
          ? " — that key id is not known to this store."
          : code === "AccessDenied"
            ? " — the key is valid but not allowed to do this."
            : code
              ? ` — ${code}.`
              : ".";
  return `${prefix} (${res.status})${hint}`;
}
