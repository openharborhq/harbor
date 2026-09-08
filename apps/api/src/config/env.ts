import { z } from "zod";

/** Every process (api, worker, setup CLI) validates its environment once at boot and fails loudly. */
export const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  /** Path to the 32-byte KEK. A Docker secret in production; never the key itself (spec §3.3). */
  HARBOR_KEK_FILE: z.string().min(1),
  HARBOR_DATA_DIR: z.string().min(1),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  SESSION_COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  OCR_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  /** tesseract language packs installed in the worker image, "+"-joined. */
  OCR_LANGUAGES: z.string().regex(/^[a-z_]+(\+[a-z_]+)*$/).default("deu+eng"),
  /**
   * Spec §5. `none` = heuristics only, nothing leaves the box; `openai-compatible` pointed at
   * Ollama on the LAN is the other way to keep it that way.
   */
  SUGGEST_PROVIDER: z.enum(["none", "anthropic", "openai-compatible"]).default("none"),
  SUGGEST_MODEL: z.string().default("claude-opus-5"),
  /** `openai-compatible` only: the server's OpenAI base, e.g. https://api.openai.com/v1 or http://ollama:11434/v1. */
  SUGGEST_BASE_URL: z.string().url().optional(),
  /** Send family members' first names so the model can guess who a document is about. */
  SUGGEST_SEND_PEOPLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  SUGGEST_READER_LANGUAGE: z.string().min(2).max(8).default("en"),
  /** Docker secret path holding the Anthropic key; falls back to ANTHROPIC_API_KEY. */
  ANTHROPIC_API_KEY_FILE: z.string().optional(),
  /** Same, for `openai-compatible`; falls back to SUGGEST_API_KEY. Absent is valid — local servers want no key. */
  SUGGEST_API_KEY_FILE: z.string().optional(),
  /** How often mailfetch sweeps every connection (spec §7.5). IDLE will make this the fallback, not the driver. */
  MAIL_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(300),
  /** Stamped into the image at build (see infra/docker/*.Dockerfile). "dev" for a hand-built one. */
  /**
   * Ask GitHub, once a day, whether a newer release exists, so Settings can say so. It is the one
   * outbound call the vault makes that is not doing work you asked for: it sends nothing about you
   * or your documents — just a GET for the repository's tags — but it does reveal that this
   * address runs Harbor. Set to false and the check never happens (spec §3.7, no telemetry).
   */
  HARBOR_UPDATE_CHECK: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  HARBOR_VERSION: z.string().default("dev"),
  HARBOR_COMMIT: z.string().default("unknown"),
  /**
   * Backups (spec §3.4). Unset RESTIC_REPOSITORY means "not configured": the backup container
   * still runs, so that Settings can say so, and every scheduled run is recorded as failed.
   * The repository password is a Docker secret file next to the KEK, never the value itself.
   */
  RESTIC_REPOSITORY: z.string().min(1).optional(),
  RESTIC_PASSWORD_FILE: z.string().min(1).optional(),
  /** Local hour the nightly backup starts, and the day of month of the automated restore test. */
  BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(3),
  BACKUP_RESTORE_TEST_DAY: z.coerce.number().int().min(1).max(28).default(1),
  BACKUP_KEEP_DAILY: z.coerce.number().int().min(1).default(30),
  BACKUP_KEEP_MONTHLY: z.coerce.number().int().min(0).default(12),
  /**
   * `false` for a repository whose key cannot delete (the ransomware-proof B2 setup, §3.4):
   * `forget --prune` would fail there, so prune from a machine that holds a full key instead.
   */
  BACKUP_PRUNE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});
export type Env = z.infer<typeof Env>;

/**
 * An empty variable is an unset one.
 *
 * Compose interpolates `${SUGGEST_BASE_URL:-}` to an empty string and passes it into the
 * container; a shell would simply have left it unset. `z.string().url().optional()` accepts
 * absent and rejects "", so the suggester container crash-looped on a URL nobody had set — found
 * the first time the full stack ran from images. Dropping empties before validation makes the
 * two mean the same thing everywhere.
 */
function withoutEmpty(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v !== "")) as NodeJS.ProcessEnv;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(withoutEmpty(source));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
