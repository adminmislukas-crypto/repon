import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRole, Role } from '@repon/types';
import type { AuthenticatedRequest } from '../authenticated-request';
import { AuthError } from '../auth.errors';
import { ADMIN_ROLES_KEY, ROLES_KEY } from '../decorators/roles.decorator';

/**
 * The second of `core-api`'s two `APP_GUARD`s, running after `AuthGuard`
 * (`core-api-auth-guard` spec). Reads `@Roles()`/`@AdminRoles()` metadata
 * (handler, falling back to class) via `Reflector`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  // `@Inject(Reflector)` explicit — see `AuthGuard`'s constructor comment:
  // bare `reflector: Reflector` typing depends on `emitDecoratorMetadata`,
  // which `tsx`/esbuild (`start:dev`) does not emit.
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const adminRoles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles && !adminRoles) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actor = request.actor;
    if (!actor) {
      // AuthGuard always runs first and sets this on any non-@Public()
      // route — a missing actor here is a wiring bug, not a request path.
      throw new Error('RolesGuard invoked without request.actor — AuthGuard must run first.');
    }

    if (adminRoles) {
      if (actor.role !== 'admin') {
        throw new AuthError(403, 'ROLE_NOT_ALLOWED', `Role '${actor.role}' is not allowed`);
      }
      if (actor.adminRole === null) {
        throw new AuthError(403, 'ADMIN_SUBROLE_MISSING', 'Actor has no admin sub-role assigned');
      }
      if (!adminRoles.includes(actor.adminRole)) {
        throw new AuthError(
          403,
          'ADMIN_SUBROLE_NOT_ALLOWED',
          `Admin sub-role '${actor.adminRole}' is not allowed`,
        );
      }
      return true;
    }

    if (!roles?.includes(actor.role)) {
      throw new AuthError(403, 'ROLE_NOT_ALLOWED', `Role '${actor.role}' is not allowed`);
    }
    return true;
  }
}
