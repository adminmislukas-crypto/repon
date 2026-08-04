import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../authenticated-request';
import { AuthError } from '../auth.errors';
import type { ActorPort, AuthenticatedActor } from '../ports/actor.port';
import { InvalidTokenError, type JwtVerifier } from '../jwt/jwt-verifier.port';
import { AuthGuard } from './auth.guard';

// core-api-auth-guard spec, "AuthGuard authentication matrix" — every branch
// of design.md D-E's diagram (1)-(6) plus the `@Public()` bypass, exercised
// with a mocked `Reflector`/`JwtVerifier`/`ActorPort` and a fake
// `ExecutionContext`, per the design's own testing strategy table ("Jest +
// JwtVerifier y ActorPort mockeados + ExecutionContext falso").

const SUBJECT = '11111111-1111-1111-1111-111111111111';

function buildReflector(isPublic: boolean): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as unknown as Reflector;
}

function buildContext(request: AuthenticatedRequest): ExecutionContext {
  const handler = (): void => undefined;
  class FakeController {}
  return {
    getHandler: () => handler,
    getClass: () => FakeController,
    switchToHttp: () => ({
      getRequest: <T>(): T => request as unknown as T,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function buildRequest(authorization?: string): AuthenticatedRequest {
  return { headers: authorization === undefined ? {} : { authorization } };
}

function activeActor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    profileId: SUBJECT,
    role: 'user',
    status: 'activo',
    companyId: null,
    companyStatus: null,
    adminRole: null,
    ...overrides,
  };
}

async function expectAuthError(
  promise: Promise<unknown>,
  statusCode: number,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AuthError);
  await promise.catch((error: unknown) => {
    const authError = error as AuthError;
    expect(authError.getStatus()).toBe(statusCode);
    expect(authError.getResponse()).toMatchObject({ statusCode, code });
  });
}

describe('AuthGuard', () => {
  let jwtVerifier: jest.Mocked<JwtVerifier>;
  let actorPort: jest.Mocked<ActorPort>;

  beforeEach(() => {
    jwtVerifier = { verify: jest.fn() };
    actorPort = { findActorById: jest.fn() };
  });

  it('lets a @Public() route through without touching the JWT verifier or actor port', async () => {
    const guard = new AuthGuard(buildReflector(true), jwtVerifier, actorPort);
    const request = buildRequest(undefined);
    const context = buildContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(jwtVerifier.verify).not.toHaveBeenCalled();
    expect(actorPort.findActorById).not.toHaveBeenCalled();
    expect(request.actor).toBeUndefined();
  });

  it('responds 401 MISSING_BEARER_TOKEN when the Authorization header is absent', async () => {
    const guard = new AuthGuard(buildReflector(false), jwtVerifier, actorPort);
    const context = buildContext(buildRequest(undefined));

    await expectAuthError(guard.canActivate(context), 401, 'MISSING_BEARER_TOKEN');
    expect(jwtVerifier.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['empty string', ''],
    ['no scheme at all', 'just-a-token'],
    ['wrong scheme', 'Basic dXNlcjpwYXNz'],
    ['bearer with no token', 'Bearer'],
    ['bearer with only whitespace after it', 'Bearer '],
  ])('responds 401 MISSING_BEARER_TOKEN for a malformed header (%s)', async (_label, header) => {
    const guard = new AuthGuard(buildReflector(false), jwtVerifier, actorPort);
    const context = buildContext(buildRequest(header));

    await expectAuthError(guard.canActivate(context), 401, 'MISSING_BEARER_TOKEN');
    expect(jwtVerifier.verify).not.toHaveBeenCalled();
  });

  it('accepts a case-insensitive "bearer" scheme', async () => {
    jwtVerifier.verify.mockResolvedValue({ sub: SUBJECT });
    actorPort.findActorById.mockResolvedValue(activeActor());
    const guard = new AuthGuard(buildReflector(false), jwtVerifier, actorPort);
    const context = buildContext(buildRequest('bearer a.b.c'));

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtVerifier.verify).toHaveBeenCalledWith('a.b.c');
  });

  it('responds 401 INVALID_TOKEN when JwtVerifier rejects the token', async () => {
    jwtVerifier.verify.mockRejectedValue(new InvalidTokenError());
    const guard = new AuthGuard(buildReflector(false), jwtVerifier, actorPort);
    const context = buildContext(buildRequest('Bearer bad.token'));

    await expectAuthError(guard.canActivate(context), 401, 'INVALID_TOKEN');
    expect(actorPort.findActorById).not.toHaveBeenCalled();
  });

  it('responds 401 INVALID_TOKEN when the sub claim is not a UUID', async () => {
    jwtVerifier.verify.mockResolvedValue({ sub: 'not-a-uuid' });
    const guard = new AuthGuard(buildReflector(false), jwtVerifier, actorPort);
    const context = buildContext(buildRequest('Bearer a.b.c'));

    await expectAuthError(guard.canActivate(context), 401, 'INVALID_TOKEN');
    expect(actorPort.findActorById).not.toHaveBeenCalled();
  });

  it('responds 503 AUTH_BACKEND_UNAVAILABLE when ActorPort throws, never allowing the request through', async () => {
    jwtVerifier.verify.mockResolvedValue({ sub: SUBJECT });
    actorPort.findActorById.mockRejectedValue(new Error('connection refused'));
    const guard = new AuthGuard(buildReflector(false), jwtVerifier, actorPort);
    const context = buildContext(buildRequest('Bearer a.b.c'));

    await expectAuthError(guard.canActivate(context), 503, 'AUTH_BACKEND_UNAVAILABLE');
  });

  it('responds 401 PROFILE_NOT_PROVISIONED when ActorPort resolves null', async () => {
    jwtVerifier.verify.mockResolvedValue({ sub: SUBJECT });
    actorPort.findActorById.mockResolvedValue(null);
    const guard = new AuthGuard(buildReflector(false), jwtVerifier, actorPort);
    const context = buildContext(buildRequest('Bearer a.b.c'));

    await expectAuthError(guard.canActivate(context), 401, 'PROFILE_NOT_PROVISIONED');
  });

  it('responds 403 PROFILE_SUSPENDED when the resolved actor is suspended', async () => {
    jwtVerifier.verify.mockResolvedValue({ sub: SUBJECT });
    actorPort.findActorById.mockResolvedValue(activeActor({ status: 'suspendido' }));
    const guard = new AuthGuard(buildReflector(false), jwtVerifier, actorPort);
    const context = buildContext(buildRequest('Bearer a.b.c'));

    await expectAuthError(guard.canActivate(context), 403, 'PROFILE_SUSPENDED');
  });

  it('lets a provider through even when their company is suspended (business rule, not this guard)', async () => {
    const provider = activeActor({
      role: 'provider',
      companyId: '22222222-2222-2222-2222-222222222222',
      companyStatus: 'suspendido',
    });
    jwtVerifier.verify.mockResolvedValue({ sub: SUBJECT });
    actorPort.findActorById.mockResolvedValue(provider);
    const guard = new AuthGuard(buildReflector(false), jwtVerifier, actorPort);
    const request = buildRequest('Bearer a.b.c');
    const context = buildContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.actor).toBe(provider);
  });

  it('sets request.actor and proceeds for a valid active actor', async () => {
    const actor = activeActor();
    jwtVerifier.verify.mockResolvedValue({ sub: SUBJECT });
    actorPort.findActorById.mockResolvedValue(actor);
    const guard = new AuthGuard(buildReflector(false), jwtVerifier, actorPort);
    const request = buildRequest('Bearer a.b.c');
    const context = buildContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.actor).toBe(actor);
  });

  it('calls ActorPort exactly once per request, never caching across calls', async () => {
    jwtVerifier.verify.mockResolvedValue({ sub: SUBJECT });
    actorPort.findActorById.mockResolvedValue(activeActor());
    const guard = new AuthGuard(buildReflector(false), jwtVerifier, actorPort);

    await guard.canActivate(buildContext(buildRequest('Bearer a.b.c')));
    await guard.canActivate(buildContext(buildRequest('Bearer a.b.c')));

    expect(actorPort.findActorById).toHaveBeenCalledTimes(2);
  });

  it('throws defensively if invoked with no ACTOR_PORT bound (must never happen before PR 6)', async () => {
    jwtVerifier.verify.mockResolvedValue({ sub: SUBJECT });
    const guard = new AuthGuard(buildReflector(false), jwtVerifier, undefined);
    const context = buildContext(buildRequest('Bearer a.b.c'));

    await expect(guard.canActivate(context)).rejects.toThrow(/ACTOR_PORT/);
  });
});
