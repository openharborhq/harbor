import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { VersionInfo } from "@harbor/shared";
import type { Env } from "../config/env";

const TAGS_URL = "https://api.github.com/repos/openharborhq/harbor/tags";
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8_000;

/**
 * "Is there a newer release?" — asked once a day, answered from memory in between.
 *
 * Deliberately not a background timer: it runs on the first request that finds the answer stale,
 * so a vault nobody opens never speaks to GitHub at all. Nothing about the deployment is sent;
 * a failed check is reported as a failure rather than silently reading as "up to date", because
 * "no update available" and "could not ask" must not look the same on a security page.
 */
@Injectable()
export class VersionService {
  private readonly log = new Logger(VersionService.name);
  private readonly current: string;
  private readonly commit: string;
  private readonly enabled: boolean;
  private latest: string | null = null;
  private checkedAt: Date | null = null;
  private problem: string | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(config: ConfigService<Env, true>) {
    this.current = config.get("HARBOR_VERSION", { infer: true });
    this.commit = config.get("HARBOR_COMMIT", { infer: true });
    this.enabled = config.get("HARBOR_UPDATE_CHECK", { infer: true });
  }

  async info(): Promise<VersionInfo> {
    if (this.enabled && this.isStale()) await this.refresh();
    return {
      current: this.current,
      commit: this.commit,
      latest: this.latest,
      updateAvailable: Boolean(this.latest && isNewer(this.latest, this.current)),
      checkEnabled: this.enabled,
      checkedAt: this.checkedAt?.toISOString() ?? null,
      problem: this.problem,
    };
  }

  private isStale(): boolean {
    return !this.checkedAt || Date.now() - this.checkedAt.getTime() > CHECK_EVERY_MS;
  }

  /** One request at a time: several people opening Settings at once should not be several calls. */
  private refresh(): Promise<void> {
    this.inFlight ??= this.fetchLatest().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetchLatest(): Promise<void> {
    try {
      const res = await fetch(TAGS_URL, {
        headers: { accept: "application/vnd.github+json", "user-agent": "harbor" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const tags = (await res.json()) as { name?: string }[];
      const newest = tags
        .map((t) => t.name ?? "")
        .filter((n) => /^v\d+\.\d+\.\d+$/.test(n))
        .sort(compareVersions)
        .pop();
      this.latest = newest ?? null;
      this.problem = null;
      this.checkedAt = new Date();
    } catch (err) {
      // A box with no route out is a perfectly ordinary deployment; say so once, quietly.
      this.problem = (err as Error).message;
      this.checkedAt = new Date();
      this.log.log(`update check failed (${this.problem}) — Settings will say the check did not run`);
    }
  }
}

/** Semver-ish comparison over `vMAJOR.MINOR.PATCH`, which is the only shape we publish. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [a1, a2, a3] = parts(a);
  const [b1, b2, b3] = parts(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}

/** A hand-built image reports "dev", which is never behind a release — it is off the map. */
export function isNewer(latest: string, current: string): boolean {
  if (!/^v\d+\.\d+\.\d+$/.test(current)) return false;
  return compareVersions(latest, current) > 0;
}
