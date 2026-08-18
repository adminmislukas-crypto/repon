import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitKeySpec {
  readonly scope: string;
  readonly dimension: 'ip' | 'email';
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitOptions {
  readonly keys: readonly RateLimitKeySpec[];
  readonly resetOnSuccess: readonly ('ip' | 'email')[];
  readonly countsAsFailure: (error: unknown) => boolean;
}

/**
 * Route-level rate-limit policy consumed by `RateLimitInterceptor`
 * (`design.md` D-3, PR2b). Never an `APP_GUARD`/global interceptor — mounted
 * per-route so login/refresh throttling stays independent of any future
 * general-purpose throttling decision.
 */
export const RateLimit = (options: RateLimitOptions): ReturnType<typeof SetMetadata> =>
  SetMetadata(RATE_LIMIT_KEY, options);
