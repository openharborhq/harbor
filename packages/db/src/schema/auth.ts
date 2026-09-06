import { pgTable, uuid, text, boolean, timestamp, inet, index } from "drizzle-orm/pg-core";

/** People who log in. Distinct from `people` (family members documents are about) — spec §1. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(), // argon2id
  totpSecretEnc: text("totp_secret_enc"), // wrapped with the KEK
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  recoveryCodeHashes: text("recovery_code_hashes").array().notNull().default([]),
  displayName: text("display_name").notNull(),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    /** Password accepted but TOTP not yet — session is not usable until this is set. */
    totpVerifiedAt: timestamp("totp_verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);
