import { HttpException } from '@nestjs/common';

/**
 * 429 for `RateLimitInterceptor` (`design.md` D-3). Deliberately its own
 * class here, not a widened `AuthError` — `AuthErrorCode` is documented as
 * the closed set of `AuthGuard`/`RolesGuard` rejections, and rate limiting
 * is neither. `GlobalExceptionFilter.isErrorBody` emits this
 * `{ statusCode, code, message }` payload verbatim, so `shared/auth/auth.errors.ts`
 * stays untouched.
 */
export class DemasiadosIntentosError extends HttpException {
  constructor(message: string) {
    super({ statusCode: 429, code: 'DEMASIADOS_INTENTOS', message }, 429);
  }
}
