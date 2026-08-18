import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../authenticated-request';

/**
 * mobile-auth-login design.md D-2: reads the raw bearer token for
 * `DELETE /identidad/sesion` (logout), to forward to
 * `AuthProvider.revokeSession`. A decorator only — no
 * `AuthGuard`/`JwtVerifier`/`ActorPort` change. By the time this runs,
 * `AuthGuard` has already verified the header exists and is well-formed
 * (`MISSING_BEARER_TOKEN`/`INVALID_TOKEN`); the split here is defensive,
 * not a new failure path.
 */
export const BearerToken = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const [, token] = request.headers.authorization?.split(' ') ?? [];
    return token ?? '';
  },
);
