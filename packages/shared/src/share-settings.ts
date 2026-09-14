import { z } from "zod/v4";

/**
 * Where a `bucket` share is pushed (spec §10.10).
 *
 * One `s3` sink covers every store worth supporting, so what changes between them is an endpoint
 * and a region — **settings presets, not code paths**, the same rule §5 applies to the LLM
 * providers. A preset that is not listed here has not been verified against, which is deliberate:
 * "the vendor's docs say S3-compatible" is not the same as "presigning and content types behave".
 */
export const SHARE_BUCKET_PRESETS = [
  { id: "b2", label: "Backblaze B2", endpoint: "https://s3.{region}.backblazeb2.com", regionHint: "eu-central-003" },
  { id: "r2", label: "Cloudflare R2", endpoint: "https://{account}.r2.cloudflarestorage.com", regionHint: "auto" },
  { id: "s3", label: "Amazon S3", endpoint: "https://s3.{region}.amazonaws.com", regionHint: "eu-central-1" },
  { id: "wasabi", label: "Wasabi", endpoint: "https://s3.{region}.wasabisys.com", regionHint: "eu-central-1" },
  { id: "minio", label: "MinIO or another S3-compatible store", endpoint: "", regionHint: "us-east-1" },
] as const;

export type ShareBucketPreset = (typeof SHARE_BUCKET_PRESETS)[number]["id"];

export const ShareBucketSettings = z.object({
  endpoint: z.string().nullable(),
  bucket: z.string().nullable(),
  region: z.string(),
  keyId: z.string().nullable(),
  /** Never the secret itself — only whether one is held. It does not leave the box. */
  secretSet: z.boolean(),
  prefix: z.string(),
  /** True when nothing has been saved and the process's environment is what is in use. */
  fromEnvironment: z.boolean(),
  /** False until endpoint, key and secret are all present; the share screen reads this. */
  usable: z.boolean(),
});
export type ShareBucketSettings = z.infer<typeof ShareBucketSettings>;

export const UpdateShareBucketSettings = z.object({
  endpoint: z.string().trim().url("That is not a web address — it should start with https://").or(z.literal("")).optional(),
  bucket: z.string().trim().max(200).optional(),
  region: z.string().trim().max(60).optional(),
  keyId: z.string().trim().max(200).optional(),
  /** Omitted keeps what is stored; an empty string is a deliberate "forget it". */
  secret: z.string().max(500).optional(),
  prefix: z.string().trim().max(120).optional(),
});
export type UpdateShareBucketSettings = z.infer<typeof UpdateShareBucketSettings>;

/**
 * What a Test press reports. It writes a small object, reads it back through a signed URL and
 * deletes it — the three things a share actually needs, proved in the order a share needs them,
 * rather than a credential check that would pass on a bucket shares could not be served from.
 */
export const ShareBucketTestResult = z.object({
  ok: z.boolean(),
  message: z.string(),
  /** Which step failed, so the message can name it: write, read back, or clean up. */
  step: z.enum(["write", "read", "delete", "done"]).optional(),
});
export type ShareBucketTestResult = z.infer<typeof ShareBucketTestResult>;
