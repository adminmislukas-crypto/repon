import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AdminRole, Role } from '@repon/types';
import type { AuthenticatedRequest } from '../authenticated-request';
import { AuthError } from '../auth.errors';
import { ADMIN_ROLES_KEY, ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedActor } from '../ports/actor.port';
import { RolesGuard } from './roles.guard';

// core-api-auth-guard spec, "RolesGuard authorization matrix" — every branch
// of roles.guard.ts (no-metadata bypass, plain-role allow/deny, and the
// three admin-specific denials), exercised with a mocked `Reflector` and a
// fake `ExecutionContext`, mirroring auth.guard.spec.ts's testing strategy.

const SUBJECT = '11111111-1111-1111-1111-111111111111';

function buildReflector(roles: Role[] | undefined, adminRoles: AdminRole[] | undefined): Reflector {
  const getAllAndOverride = jest.fn((key: string) => {
    if (key === ROLES_KEY) return roles;
    if (key === ADMIN_ROLES_KEY) return adminRoles;
    return undefined;
  });
  return { getAllAndOverride } as unknown as Reflector;
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

function buildRequest(actor?: AuthenticatedActor): AuthenticatedRequest {
  return { headers: {}, actor };
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

/** Sync counterpart of auth.guard.spec.ts's `expectAuthError` — `RolesGuard.canActivate` is not async. */
function expectRoleAuthError(guard: RolesGuard, context: ExecutionContext, statusCode: number, code: string): void {
  expect(() => guard.canActivate(context)).toThrow(AuthError);
  try {
    guard.canActivate(context);
    throw new Error('expected canActivate to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    const authError = error as AuthError;
    expect(authError.getStatus()).toBe(statusCode);
    expect(authError.getResponse()).toMatchObject({ statusCode, code });
  }
}

describe('RolesGuard', () => {
  it('proceeds when the handler has neither @Roles() nor @AdminRoles()', () => {
    const guard = new RolesGuard(buildReflector(undefined, undefined));
    const context = buildContext(buildRequest(undefined));

    expect(guard.canActivate(context)).toBe(true);
  });

  it('proceeds when the actor role is in the @Roles() allow-list', () => {
    const guard = new RolesGuard(buildReflector(['provider', 'admin'], undefined));
    const actor = activeActor({ role: 'provider' });
    const context = buildContext(buildRequest(actor));

    expect(guard.canActivate(context)).toBe(true);
  });

  it('responds 403 ROLE_NOT_ALLOWED when the actor role is not in the @Roles() allow-list', () => {
    const guard = new RolesGuard(buildReflector(['provider'], undefined));
    const actor = activeActor({ role: 'user' });
    const context = buildContext(buildRequest(actor));

    expectRoleAuthError(guard, context, 403, 'ROLE_NOT_ALLOWED');
  });

  it('responds 403 ROLE_NOT_ALLOWED when @AdminRoles() is set and actor.role is not admin', () => {
    const guard = new RolesGuard(buildReflector(undefined, ['super_admin']));
    const actor = activeActor({ role: 'user' });
    const context = buildContext(buildRequest(actor));

    expectRoleAuthError(guard, context, 403, 'ROLE_NOT_ALLOWED');
  });

  it('responds 403 ADMIN_SUBROLE_MISSING when actor.role is admin but adminRole is null', () => {
    const guard = new RolesGuard(buildReflector(undefined, ['super_admin']));
    const actor = activeActor({ role: 'admin', adminRole: null });
    const context = buildContext(buildRequest(actor));

    expectRoleAuthError(guard, context, 403, 'ADMIN_SUBROLE_MISSING');
  });

  it('responds 403 ADMIN_SUBROLE_NOT_ALLOWED when the admin sub-role is not in the @AdminRoles() list', () => {
    const guard = new RolesGuard(buildReflector(undefined, ['super_admin']));
    const actor = activeActor({ role: 'admin', adminRole: 'soporte' });
    const context = buildContext(buildRequest(actor));

    expectRoleAuthError(guard, context, 403, 'ADMIN_SUBROLE_NOT_ALLOWED');
  });

  it('proceeds when the admin sub-role is in the @AdminRoles() allow-list', () => {
    const guard = new RolesGuard(buildReflector(undefined, ['super_admin', 'soporte']));
    const actor = activeActor({ role: 'admin', adminRole: 'soporte' });
    const context = buildContext(buildRequest(actor));

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws a plain Error (not AuthError) when invoked without request.actor — AuthGuard must run first', () => {
    const guard = new RolesGuard(buildReflector(['provider'], undefined));
    const context = buildContext(buildRequest(undefined));

    expect(() => guard.canActivate(context)).toThrow(/AuthGuard must run first/);
    try {
      guard.canActivate(context);
      throw new Error('expected canActivate to throw');
    } catch (error) {
      expect(error).not.toBeInstanceOf(AuthError);
    }
  });
});
