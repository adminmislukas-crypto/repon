import {
  Inject,
  Injectable,
  Optional,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../authenticated-request';
import { AuthError } from '../auth.errors';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JWT_VERIFIER, type JwtVerifier } from '../jwt/jwt-verifier.port';
import { ACTOR_PORT, type ActorPort, type AuthenticatedActor } from '../ports/actor.port';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * The first of `core-api`'s two `APP_GUARD`s (`core-api-auth-guard` spec) —
 * fail-closed by default, `@Public()` is the only opt-out (design.md D-E).
 *
 * NOT registered as `APP_GUARD` in this PR (task 3.7): `ACTOR_PORT` has no
 * provider until `IdentidadModule` (PR 6) binds it — registering this
 * globally now would make the app fail to boot. `ACTOR_PORT` is injected
 * with `@Optional()` for the same reason: `AuthModule`/`SharedKernelModule`
 * must be importable today without Nest's eager singleton instantiation
 * throwing on an unresolvable dependency. The defensive throw in
 * `canActivate` below is the loud failure if this guard is ever invoked
 * before PR 6 wires a real `ActorPort` — it should never happen, since
 * nothing mounts this guard yet.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    // `@Inject(Reflector)` explicit, not left to bare-type inference:
    // `emitDecoratorMetadata`'s `design:paramtypes` is what resolves a plain
    // `reflector: Reflector` param, and `tsx`/esbuild (this service's
    // `start:dev`, package.json) does not emit it — verified empirically,
    // this guard fails to boot under `tsx` without the explicit token even
    // though it typechecks and passes under `tsc`/`ts-jest` (both do full
    // program compilation). `@Inject()` writes Nest's own metadata directly,
    // independent of that compiler feature.
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JWT_VERIFIER) private readonly jwtVerifier: JwtVerifier,
    @Optional() @Inject(ACTOR_PORT) private readonly actorPort?: ActorPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new AuthError(401, 'MISSING_BEARER_TOKEN', 'Missing or malformed Authorization header');
    }

    let sub: string;
    try {
      ({ sub } = await this.jwtVerifier.verify(token));
    } catch {
      throw new AuthError(
        401,
        'INVALID_TOKEN',
        'Token failed signature, issuer, audience, or expiry verification',
      );
    }

    if (!UUID_RE.test(sub)) {
      throw new AuthError(401, 'INVALID_TOKEN', 'Token sub claim is not a UUID');
    }

    if (!this.actorPort) {
      throw new Error(
        'AuthGuard invoked without an ACTOR_PORT provider — not expected until PR 6 wires IdentidadModule.',
      );
    }

    let actor: AuthenticatedActor | null;
    try {
      actor = await this.actorPort.findActorById(sub);
    } catch {
      // Infrastructure failure is 503, never a silent allow (R1).
      throw new AuthError(503, 'AUTH_BACKEND_UNAVAILABLE', 'Actor backend is unreachable');
    }

    if (actor === null) {
      // A valid token with no known identity is not a permissions failure.
      throw new AuthError(
        401,
        'PROFILE_NOT_PROVISIONED',
        'No profile is provisioned for this subject',
      );
    }

    if (actor.status === 'suspendido') {
      // 403, not 401: the identity IS known — 401 would trigger a client
      // refresh-token retry loop instead of signing the user out.
      throw new AuthError(403, 'PROFILE_SUSPENDED', 'Profile is suspended');
    }

    // A provider with a suspended company still authenticates here —
    // `companyStatus` is loaded but never blocks at this layer (design.md D-E).
    request.actor = actor;
    return true;
  }
}
