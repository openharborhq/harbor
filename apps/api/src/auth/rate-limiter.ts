/**
 * In-memory sliding window. Enough for a two-owner vault behind a tailnet; not shared across
 * processes (the API runs as one container). Keyed by the caller (IP, email, session).
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns true if the call is allowed (and records it). */
  allow(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((ts) => t - ts < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
