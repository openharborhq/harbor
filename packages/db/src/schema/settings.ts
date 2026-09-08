import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Configuration an owner can change from the browser, rather than by editing a file over ssh
 * (spec §3.7). One row per key, read at point of use so a change takes effect without restarting
 * a container.
 *
 * Secrets — an API key, a backup repository's credentials — are sealed under the KEK exactly as
 * `mail_connections.secret_enc` is, so a database dump never carries them in the clear. The env
 * file remains the fallback for every key: absent here means "whatever the environment says",
 * which keeps existing installs and unattended provisioning working unchanged.
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  /** Plaintext for ordinary settings; a sealed string when `secret` is true. */
  value: text("value").notNull(),
  secret: boolean("secret").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
