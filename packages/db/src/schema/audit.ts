import { pgTable, uuid, text, jsonb, inet, timestamp, bigserial, index } from "drizzle-orm/pg-core";
import { users } from "./auth";

/** From day one (spec §1): "who moved the deed?" cannot be backfilled. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(), // e.g. auth.login, document.upload, document.download
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ip: inet("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entityType, t.entityId), index("audit_log_created_idx").on(t.createdAt)],
);
