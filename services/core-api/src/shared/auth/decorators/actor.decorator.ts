import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedActor } from '../ports/actor.port';
import type { AuthenticatedRequest } from '../authenticated-request';

/**
 * Reads `request.actor`, set by `AuthGuard`. `undefined` on `@Public()`
 * routes. `core-api-auth-guard` spec, "Controller passes scalars, not the
 * actor object" — callers MUST read a scalar (e.g. `actor.profileId`) off
 * this before handing it to a use case; the object itself never crosses
 * ports-in.
 */
export const Actor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedActor | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.actor;
  },
);
