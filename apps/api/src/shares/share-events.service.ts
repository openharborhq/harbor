import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { shareAccessLog, shareLinks, type Db } from "@harbor/db";
import { DB } from "../db/db.module";
import { DoormanSink } from "./share-sink";
import { SharesService } from "./shares.service";

const SWEEP_MS = 30_000;

interface DoormanEvent {
  at: string;
  event: string;
  ip: string | null;
  userAgent: string | null;
  reason?: string;
  bytes?: number;
}

/**
 * Folding the doorman's log into the database (spec §10.2).
 *
 * The doorman has no database connection and no way to call the API — that is most of why it is
 * safe — so what a recipient did travels back as an append-only file the vault reads. This is the
 * reading half. It runs inside the API rather than as a sixth container because it does nothing a
 * container would buy: it reads a directory on the same volume and writes rows.
 *
 * Each token's log is consumed by byte offset, recorded next to it, so a sweep never re-reads what
 * it has already ingested and a half-written final line is simply left for the next pass.
 */
@Injectable()
export class ShareEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ShareEventsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly doorman: DoormanSink,
    private readonly shares: SharesService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    // Don't hold the process open for a housekeeping timer.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const ingested = await this.ingestEvents();
      await this.shares.purgeExpired();
      return ingested;
    } catch (err) {
      this.log.error(`Share event sweep failed: ${(err as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async ingestEvents(): Promise<number> {
    const stateRoot = this.doorman.stateRoot;
    let tokenDirs: string[];
    try {
      tokenDirs = await readdir(stateRoot);
    } catch {
      return 0; // Nothing has ever been shared on this install.
    }

    let total = 0;
    for (const tokenHash of tokenDirs) {
      try {
        total += await this.ingestOne(stateRoot, tokenHash);
      } catch (err) {
        this.log.warn(`Could not read the doorman's log for ${tokenHash.slice(0, 8)}…: ${(err as Error).message}`);
      }
    }
    return total;
  }

  private async ingestOne(stateRoot: string, tokenHash: string): Promise<number> {
    const dir = path.join(stateRoot, tokenHash);
    const logPath = path.join(dir, "events.jsonl");
    const markPath = path.join(dir, ".ingested");

    const size = (await stat(logPath).catch(() => null))?.size;
    if (!size) return 0;
    const from = Number((await readFile(markPath, "utf8").catch(() => "0")).trim()) || 0;
    if (from >= size) return 0;

    const [link] = await this.db.select().from(shareLinks).where(eq(shareLinks.tokenHash, tokenHash));
    if (!link) {
      // A log with no link: the share was deleted outright. Mark it read so it is not retried.
      await writeFile(markPath, String(size));
      return 0;
    }

    const raw = (await readFile(logPath, "utf8")).slice(from);
    // A trailing partial line means the doorman is mid-append; leave it for the next sweep.
    const lines = raw.split("\n");
    const complete = raw.endsWith("\n") ? lines.slice(0, -1) : lines.slice(0, -1);
    const consumed = complete.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0);
    if (!complete.length) return 0;

    const rows: (typeof shareAccessLog.$inferInsert)[] = [];
    let downloads = 0;
    let lastDownloadAt: Date | null = null;
    let firstOpenAt: Date | null = null;

    for (const line of complete) {
      let event: DoormanEvent;
      try {
        event = JSON.parse(line) as DoormanEvent;
      } catch {
        continue; // A corrupt line is skipped, not fatal — the rest of the log is still evidence.
      }
      if (!KNOWN_EVENTS.has(event.event)) continue;
      const at = new Date(event.at);
      rows.push({
        shareLinkId: link.id,
        event: event.event as (typeof shareAccessLog.$inferInsert)["event"],
        reason: event.reason ?? null,
        ip: event.ip,
        userAgent: event.userAgent,
        bytesSent: event.bytes ?? null,
        createdAt: at,
      });
      if (event.event === "download_completed") {
        downloads++;
        lastDownloadAt = at;
      }
      if (event.event === "viewed" && !firstOpenAt) firstOpenAt = at;
    }

    if (rows.length) await this.db.insert(shareAccessLog).values(rows);

    if (downloads || firstOpenAt) {
      await this.db
        .update(shareLinks)
        .set({
          // Counted from the doorman's own completions, which is the only place that knows a
          // transfer actually finished.
          downloadCount: downloads ? sql`${shareLinks.downloadCount} + ${downloads}` : undefined,
          lastDownloadedAt: lastDownloadAt ?? undefined,
          firstOpenedAt: link.firstOpenedAt ?? firstOpenAt ?? undefined,
        })
        .where(eq(shareLinks.id, link.id));
    }

    await writeFile(markPath, String(from + consumed));
    return rows.length;
  }
}

const KNOWN_EVENTS = new Set(["viewed", "password_failed", "download_started", "download_completed", "denied"]);
