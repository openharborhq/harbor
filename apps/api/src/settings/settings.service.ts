import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq, inArray } from "drizzle-orm";
import { settings, type Db } from "@harbor/db";
import type { Env } from "../config/env";
import { CryptoService } from "../crypto/crypto.service";
import { InjectDb } from "../db/db.module";

/**
 * Settings an owner changed in the browser, layered over the environment.
 *
 * The environment is the floor, never the ceiling: a key absent here means "whatever the env
 * file says", which is what keeps existing installs and scripted provisioning working after this
 * arrived. Secrets are sealed under the KEK on the way in and unsealed only where they are used.
 */
@Injectable()
export class SettingsService {
  private readonly log = new Logger(SettingsService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async getMany(keys: string[]): Promise<Map<string, string>> {
    if (!keys.length) return new Map();
    const rows = await this.db.select().from(settings).where(inArray(settings.key, keys));
    const out = new Map<string, string>();
    for (const row of rows) {
      try {
        out.set(row.key, row.secret ? this.crypto.openString(row.value) : row.value);
      } catch (err) {
        // A key that cannot be unsealed is a key from a different KEK; treat it as absent rather
        // than failing every read, and say so once so it is not a silent mystery.
        this.log.warn(`setting "${row.key}" could not be unsealed and is being ignored: ${(err as Error).message}`);
      }
    }
    return out;
  }

  async get(key: string): Promise<string | undefined> {
    return (await this.getMany([key])).get(key);
  }

  /** Undefined leaves a setting alone; null removes it, falling back to the environment again. */
  async set(key: string, value: string | null, opts: { secret?: boolean } = {}): Promise<void> {
    if (value === null) {
      await this.db.delete(settings).where(eq(settings.key, key));
      return;
    }
    const stored = opts.secret ? this.crypto.sealString(value) : value;
    await this.db
      .insert(settings)
      .values({ key, value: stored, secret: Boolean(opts.secret) })
      .onConflictDoUpdate({ target: settings.key, set: { value: stored, secret: Boolean(opts.secret), updatedAt: new Date() } });
  }

  /** A stored value if there is one, otherwise what the process was started with. */
  async withEnvFallback<K extends keyof Env>(key: string, envKey: K): Promise<Env[K] | string> {
    return (await this.get(key)) ?? this.config.get(envKey, { infer: true });
  }

  /** Which of these keys have been set here rather than inherited from the environment. */
  async storedKeys(keys: string[]): Promise<Set<string>> {
    const rows = await this.db.select({ key: settings.key }).from(settings).where(inArray(settings.key, keys));
    return new Set(rows.map((r) => r.key));
  }
}

/** The keys this table holds. Strings rather than an enum so a migration is never needed to add one. */
export const SETTING = {
  suggestProvider: "suggest.provider",
  suggestModel: "suggest.model",
  suggestBaseUrl: "suggest.baseUrl",
  suggestApiKey: "suggest.apiKey",
  suggestSendPeople: "suggest.sendPeople",
  suggestReaderLanguage: "suggest.readerLanguage",
} as const;
