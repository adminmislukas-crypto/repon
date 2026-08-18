export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

export interface RateLimitWindow {
  readonly windowMs: number;
  readonly limit: number;
}

export interface RateLimitPeekResult {
  readonly count: number;
  readonly retryAfterMs: number;
}

/**
 * Promise-returning even though `InMemoryRateLimitStore` is synchronous, so
 * a future Redis-backed adapter (`design.md` D-3) is a one-line provider
 * swap with no signature churn.
 */
export interface RateLimitStore {
  peek(key: string, window: RateLimitWindow): Promise<RateLimitPeekResult>;
  record(key: string, window: RateLimitWindow): Promise<void>;
  reset(key: string): Promise<void>;
}
