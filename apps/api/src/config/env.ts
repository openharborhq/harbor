import { z } from "zod";

/** Every process (api, worker, setup CLI) validates its environment once at boot and fails loudly. */
export const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  /** Path to the 32-byte KEK. A Docker secret in production; never the key itself (spec §3.3). */
  TW_KEK_FILE: z.string().min(1),
  TW_DATA_DIR: z.string().min(1),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  SESSION_COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  OCR_CONCURRENCY: z.coerce.number().int().min(1).default(2),
});
export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
