import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4, enough of it for one S3-compatible sink (spec §10.10).
 *
 * Hand-written rather than pulled from an SDK. The AWS SDK is tens of megabytes of code with its
 * own credential-discovery machinery — an entire dependency tree inside the process that holds the
 * KEK, to sign three kinds of request. What is actually needed is a hash chain and a canonical
 * string, and both are pinned by published test vectors, so this is verifiable in a way "we
 * upgraded the SDK" is not.
 *
 * One implementation covers every store worth supporting: B2, R2, Wasabi, MinIO, Storj and S3
 * itself all speak this. They are settings presets, not code paths (§5's rule, applied again).
 */

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** Full origin, e.g. https://s3.eu-central-1.amazonaws.com or https://s3.eu-central-003.backblazeb2.com */
  endpoint: string;
  bucket: string;
}

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function signingKey(secret: string, date: string, region: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), SERVICE), "aws4_request");
}

/** RFC 3986, which is stricter than encodeURIComponent about these five. */
function uriEncode(value: string, encodeSlash = true): string {
  return value
    .split("")
    .map((c) => {
      if (/[A-Za-z0-9\-._~]/.test(c)) return c;
      if (c === "/") return encodeSlash ? "%2F" : "/";
      return Array.from(Buffer.from(c, "utf8"))
        .map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
        .join("");
    })
    .join("");
}

/**
 * Path-style (`https://endpoint/bucket/key`) or virtual-hosted (`https://bucket.endpoint/key`),
 * decided by whether the bucket has been folded into the endpoint already. Both are in use:
 * MinIO and B2's S3 endpoint take path-style, AWS has been pushing virtual-hosted for years, and
 * R2 does either. Leaving `bucket` empty means "it is already in the host".
 */
function objectPath(creds: S3Credentials, key: string): string {
  const encoded = uriEncode(key, false);
  return creds.bucket ? `/${uriEncode(creds.bucket, false)}/${encoded}` : `/${encoded}`;
}

function timestamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * A URL that carries its own authorisation and expires on its own.
 *
 * This is what makes a dumb object store a sink at all: the recipient's browser fetches it with no
 * credential of the owner's, and the store stops honouring it when the time is up.
 *
 * **SigV4 presigned URLs are valid for at most seven days.** That limit is the reason `bucket`
 * delivery offers 24 hours and 7 days and not 30 (§10.10) — it is the protocol's, not a choice.
 */
export const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

export function presignGet(creds: S3Credentials, key: string, expiresInSeconds: number, now = new Date()): string {
  if (expiresInSeconds > MAX_PRESIGN_SECONDS) {
    throw new Error(`A signed URL cannot outlive ${MAX_PRESIGN_SECONDS} seconds; asked for ${expiresInSeconds}`);
  }
  const { amzDate, dateStamp } = timestamps(now);
  const url = new URL(creds.endpoint);
  const host = url.host;
  const path = objectPath(creds, key);
  const scope = `${dateStamp}/${creds.region}/${SERVICE}/aws4_request`;

  const query = [
    ["X-Amz-Algorithm", ALGORITHM],
    ["X-Amz-Credential", `${creds.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ]
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .sort()
    .join("&");

  const canonical = ["GET", path, query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = [ALGORITHM, amzDate, scope, sha256Hex(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(creds.secretAccessKey, dateStamp, creds.region)).update(toSign, "utf8").digest("hex");

  return `${url.origin}${path}?${query}&X-Amz-Signature=${signature}`;
}

/** Headers for an authenticated PUT. The body is hashed, so the store rejects a mangled upload. */
export function signPut(
  creds: S3Credentials,
  key: string,
  body: Buffer,
  contentType: string,
  now = new Date(),
): { url: string; headers: Record<string, string> } {
  const { amzDate, dateStamp } = timestamps(now);
  const url = new URL(creds.endpoint);
  const host = url.host;
  const path = objectPath(creds, key);
  const scope = `${dateStamp}/${creds.region}/${SERVICE}/aws4_request`;
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((h) => `${h}:${headers[h]}\n`)
    .join("");

  const canonical = ["PUT", path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const toSign = [ALGORITHM, amzDate, scope, sha256Hex(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(creds.secretAccessKey, dateStamp, creds.region)).update(toSign, "utf8").digest("hex");

  return {
    url: `${url.origin}${path}`,
    headers: {
      ...headers,
      Authorization: `${ALGORITHM} Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/** Same shape as a PUT, with an empty body — used to withdraw a share from the store. */
export function signDelete(creds: S3Credentials, key: string, now = new Date()): { url: string; headers: Record<string, string> } {
  const { amzDate, dateStamp } = timestamps(now);
  const url = new URL(creds.endpoint);
  const host = url.host;
  const path = objectPath(creds, key);
  const scope = `${dateStamp}/${creds.region}/${SERVICE}/aws4_request`;
  const payloadHash = sha256Hex("");

  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((h) => `${h}:${headers[h]}\n`)
    .join("");

  const canonical = ["DELETE", path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const toSign = [ALGORITHM, amzDate, scope, sha256Hex(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(creds.secretAccessKey, dateStamp, creds.region)).update(toSign, "utf8").digest("hex");

  return {
    url: `${url.origin}${path}`,
    headers: {
      ...headers,
      Authorization: `${ALGORITHM} Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
