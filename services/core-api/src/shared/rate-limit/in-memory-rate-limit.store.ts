import type { RateLimitPeekResult, RateLimitStore, RateLimitWindow } from './rate-limit-store.port';

/**
 * A pruned ring of failure timestamps per key — exact, not approximate,
 * unlike a fixed-window bucket or a decaying counter (`design.md` D-3: a
 * bucket boundary can admit nearly twice the limit across the edge, and a
 * decaying counter cannot answer "≥N in the trailing window" exactly).
 * Only the most recent `limit` timestamps are ever retained per key, since
 * anything past the `limit`-th cannot change a `>= limit` predicate.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly data = new Map<string, number[]>();
  private static readonly SWEEP_SIZE_CAP = 10_000;

  async peek(key: string, window: RateLimitWindow): Promise<RateLimitPeekResult> {
    const timestamps = this.prune(key, window.windowMs);
    const count = timestamps.length;
    if (count < window.limit) {
      return { count, retryAfterMs: 0 };
    }
    const now = Date.now();
    const oldestQualifying = timestamps[count - window.limit]!;
    return { count, retryAfterMs: Math.max(0, oldestQualifying + window.windowMs - now) };
  }

  async record(key: string, window: RateLimitWindow): Promise<void> {
    const timestamps = this.prune(key, window.windowMs);
    timestamps.push(Date.now());
    if (timestamps.length > window.limit) {
      timestamps.splice(0, timestamps.length - window.limit);
    }
    this.data.set(key, timestamps);
    if (this.data.size > InMemoryRateLimitStore.SWEEP_SIZE_CAP) {
      this.sweep(window.windowMs);
    }
  }

  async reset(key: string): Promise<void> {
    this.data.delete(key);
  }

  /** Test-support only — not part of the `RateLimitStore` port. */
  size(): number {
    return this.data.size;
  }

  private prune(key: string, windowMs: number): number[] {
    const now = Date.now();
    const existing = this.data.get(key) ?? [];
    const fresh = existing.filter((ts) => ts > now - windowMs);
    if (fresh.length === 0) {
      this.data.delete(key);
    } else if (fresh.length !== existing.length) {
      this.data.set(key, fresh);
    }
    return fresh;
  }

  /**
   * Bounded sweep, triggered only once the map crosses a size cap —
   * deliberately no `setInterval`: a timer would keep the Jest worker alive
   * and complicate e2e teardown (`design.md` D-3).
   */
  private sweep(windowMs: number): void {
    const now = Date.now();
    for (const [key, timestamps] of this.data) {
      const fresh = timestamps.filter((ts) => ts > now - windowMs);
      if (fresh.length === 0) {
        this.data.delete(key);
      } else if (fresh.length !== timestamps.length) {
        this.data.set(key, fresh);
      }
    }
  }
}
