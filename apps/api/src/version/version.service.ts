import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ReleaseNote, ReleaseNotes, VersionInfo } from "@harbor/shared";
import type { Env } from "../config/env";
import { readBundledChangelog, type ChangelogEntry } from "./changelog";

const TAGS_URL = "https://api.github.com/repos/openharborhq/harbor/tags";
const RELEASES_URL = "https://api.github.com/repos/openharborhq/harbor/releases?per_page=20";
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
  private readonly bundled: ChangelogEntry[] = readBundledChangelog();
  private published: ChangelogEntry[] | null = null;
  private publishedAt: Date | null = null;
  private publishedInFlight: Promise<void> | null = null;

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

  /**
   * Every release and what changed in it, newest first.
   *
   * Two sources for one list: the notes that shipped in this image, which are always available,
   * and the published releases from GitHub, which also cover versions newer than this one — the
   * point of the list being to show what an upgrade would bring, not only what you already have.
   */
  async releases(): Promise<ReleaseNotes> {
    if (this.enabled && this.releasesStale()) await this.refreshReleases();
    const merged = new Map<string, ChangelogEntry>();
    // Bundled first, so a published body (edited on GitHub after the fact) wins on the same version.
    for (const e of this.bundled) merged.set(e.version, e);
    for (const e of this.published ?? []) merged.set(e.version, e);

    const releases: ReleaseNote[] = [...merged.values()]
      .sort((a, b) => compareVersions(b.version, a.version))
      .map((e) => ({
        version: e.version,
        date: e.date,
        body: e.body,
        isCurrent: e.version === this.current,
        isNewer: isNewer(e.version, this.current),
      }));
    return { releases, offline: this.published === null };
  }

  private releasesStale(): boolean {
    return !this.publishedAt || Date.now() - this.publishedAt.getTime() > CHECK_EVERY_MS;
  }

  private refreshReleases(): Promise<void> {
    this.publishedInFlight ??= this.fetchReleases().finally(() => {
      this.publishedInFlight = null;
    });
    return this.publishedInFlight;
  }

  private async fetchReleases(): Promise<void> {
    try {
      const res = await fetch(RELEASES_URL, {
        headers: { accept: "application/vnd.github+json", "user-agent": "harbor" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const body = (await res.json()) as { tag_name?: string; published_at?: string; body?: string; draft?: boolean; prerelease?: boolean }[];
      this.published = body
        .filter((r) => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name ?? ""))
        .map((r) => ({
          version: r.tag_name!,
          date: r.published_at?.slice(0, 10) ?? null,
          body: (r.body ?? "").trim(),
        }));
      this.publishedAt = new Date();
    } catch (err) {
      // Same principle as the update check: the bundled notes still stand, and Settings says the
      // list may be short rather than pretending it is complete.
      this.publishedAt = new Date();
      this.log.log(`release notes could not be fetched (${(err as Error).message}) — showing the ones in this image`);
    }
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
