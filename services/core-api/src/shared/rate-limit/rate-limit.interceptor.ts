import {
  Inject,
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { from, throwError, type Observable } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { DemasiadosIntentosError } from './demasiados-intentos.error';
import { RATE_LIMIT_KEY, type RateLimitKeySpec, type RateLimitOptions } from './rate-limit.decorator';
import { RATE_LIMIT_STORE, type RateLimitStore } from './rate-limit-store.port';

/** Minimal structural shape — avoids a hard dependency on `@types/express`. */
interface RateLimitAwareRequest {
  body?: unknown;
  ip?: string;
}

interface RateLimitAwareResponse {
  setHeader(name: string, value: string): void;
}

interface DerivedKey {
  readonly spec: RateLimitKeySpec;
  readonly key: string;
}

interface Blocked {
  readonly spec: RateLimitKeySpec;
  readonly retryAfterMs: number;
}

/**
 * Owns both halves of the check-then-record policy `design.md` D-3
 * requires — only an interceptor spans the Nest request lifecycle on both
 * sides of the handler:
 *
 * - **PRE** (before `next.handle()`, therefore before `ValidationPipe` and
 *   the controller): `peek`s every derived key and throws 429 if any is at
 *   or over its limit. Never increments — GoTrue/the handler is never
 *   invoked for a locked-out attempt.
 * - **POST** (`tap` on the handler's stream): on success, `reset`s the keys
 *   named in `resetOnSuccess`; on error, `record`s every key iff
 *   `options.countsAsFailure(error)` is true.
 *
 * Never an `APP_GUARD`/global interceptor — mounted per-route via
 * `@RateLimit(...)` metadata, so login/refresh throttling stays independent
 * of any future general-purpose throttling decision.
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimitInterceptor.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return next.handle();

    const request = context.switchToHttp().getRequest<RateLimitAwareRequest>();
    const response = context.switchToHttp().getResponse<RateLimitAwareResponse>();
    const keys = this.deriveKeys(options.keys, request);

    return from(this.precheck(keys)).pipe(
      switchMap((blocked) => {
        if (blocked) {
          response.setHeader('Retry-After', String(Math.ceil(blocked.retryAfterMs / 1000)));
          return throwError(
            () =>
              new DemasiadosIntentosError(
                `Too many attempts (${blocked.spec.scope}:${blocked.spec.dimension})`,
              ),
          );
        }
        return next.handle().pipe(
          tap({
            next: () => this.onSuccess(keys, options),
            error: (error: unknown) => this.onFailure(keys, options, error),
          }),
        );
      }),
    );
  }

  private deriveKeys(specs: readonly RateLimitKeySpec[], request: RateLimitAwareRequest): DerivedKey[] {
    const keys: DerivedKey[] = [];
    for (const spec of specs) {
      const value = this.deriveValue(spec, request);
      if (value === null) continue;
      keys.push({ spec, key: `${spec.scope}:${spec.dimension}:${value}` });
    }
    return keys;
  }

  /** Key derivation never throws — an absent/malformed field is skipped, not fatal. */
  private deriveValue(spec: RateLimitKeySpec, request: RateLimitAwareRequest): string | null {
    if (spec.dimension === 'ip') {
      return typeof request.ip === 'string' && request.ip.length > 0 ? request.ip : null;
    }
    const body = request.body;
    const email =
      body !== null && typeof body === 'object' && 'email' in body
        ? (body as { email?: unknown }).email
        : undefined;
    if (typeof email !== 'string' || email.trim() === '') return null;
    return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  }

  private async precheck(keys: readonly DerivedKey[]): Promise<Blocked | null> {
    let worst: Blocked | null = null;
    for (const { spec, key } of keys) {
      let result;
      try {
        result = await this.store.peek(key, { limit: spec.limit, windowMs: spec.windowMs });
      } catch (error) {
        // Fail open: a limiter outage must never deny a real login.
        this.logger.warn(`RateLimitStore.peek failed for ${key}: ${String(error)}`);
        continue;
      }
      if (result.count >= spec.limit && (!worst || result.retryAfterMs > worst.retryAfterMs)) {
        worst = { spec, retryAfterMs: result.retryAfterMs };
      }
    }
    return worst;
  }

  private onSuccess(keys: readonly DerivedKey[], options: RateLimitOptions): void {
    for (const dimension of options.resetOnSuccess) {
      const entry = keys.find((candidate) => candidate.spec.dimension === dimension);
      if (!entry) continue;
      this.store.reset(entry.key).catch((error: unknown) => {
        this.logger.warn(`RateLimitStore.reset failed for ${entry.key}: ${String(error)}`);
      });
    }
  }

  private onFailure(keys: readonly DerivedKey[], options: RateLimitOptions, error: unknown): void {
    if (!options.countsAsFailure(error)) return;
    for (const { spec, key } of keys) {
      this.store.record(key, { limit: spec.limit, windowMs: spec.windowMs }).catch((recordError: unknown) => {
        this.logger.warn(`RateLimitStore.record failed for ${key}: ${String(recordError)}`);
      });
    }
  }
}
