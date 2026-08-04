import type { AuthenticatedActor } from './ports/actor.port';

/**
 * Minimal request shape `AuthGuard`/`@Actor()` need — structural typing
 * avoids a hard dependency on `@types/express` just for two fields.
 */
export interface AuthenticatedRequest {
  headers: { authorization?: string };
  actor?: AuthenticatedActor;
}
