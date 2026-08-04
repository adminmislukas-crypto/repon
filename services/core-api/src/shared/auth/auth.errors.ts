import { HttpException } from '@nestjs/common';

export type AuthErrorCode =
  | 'MISSING_BEARER_TOKEN'
  | 'INVALID_TOKEN'
  | 'AUTH_BACKEND_UNAVAILABLE'
  | 'PROFILE_NOT_PROVISIONED'
  | 'PROFILE_SUSPENDED'
  | 'ROLE_NOT_ALLOWED'
  | 'ADMIN_SUBROLE_MISSING'
  | 'ADMIN_SUBROLE_NOT_ALLOWED';

/**
 * Every `AuthGuard`/`RolesGuard` rejection is one of these — the exact shape
 * `GlobalExceptionFilter` emits verbatim: `{ statusCode, code, message }`
 * (`core-api-auth-guard` spec, "A global exception filter emits stable error
 * codes"). `code` is what a client branches on and MUST stay stable;
 * `message` is human-readable and may change.
 */
export class AuthError extends HttpException {
  constructor(statusCode: number, code: AuthErrorCode, message: string) {
    super({ statusCode, code, message }, statusCode);
  }
}
