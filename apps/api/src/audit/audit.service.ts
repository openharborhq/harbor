import { Injectable, Logger } from "@nestjs/common";
import { auditLog, type Db } from "@harbor/db";
import { InjectDb } from "../db/db.module";

export interface AuditEntry {
  action: string;
  actorUserId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Append-only. Never throws into the caller — a failed audit write is logged, not fatal. */
@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);
  constructor(@InjectDb() private readonly db: Db) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditLog).values({
        action: entry.action,
        actorUserId: entry.actorUserId ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? null,
        ip: entry.ip ?? null,
      });
    } catch (err) {
      this.log.error(`audit write failed for ${entry.action}: ${(err as Error).message}`);
    }
  }
}
