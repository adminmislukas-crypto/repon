import { SetMetadata } from '@nestjs/common';
import type { AdminRole, Role } from '@repon/types';

export const ROLES_KEY = 'roles';
export const ADMIN_ROLES_KEY = 'adminRoles';

/** Requires `actor.role` to be one of `roles`. Does not imply an admin sub-role check. */
export const Roles = (...roles: Role[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Requires `actor.role === 'admin'` AND `actor.adminRole` to be one of
 * `adminRoles`. Deliberately a separate decorator from `@Roles()`
 * (design.md D-E): a single `@Roles('super_admin')` would be ambiguous
 * about whether it also requires `role === 'admin'` — an accidental
 * omission there is a privilege-escalation bug.
 */
export const AdminRoles = (...adminRoles: AdminRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ADMIN_ROLES_KEY, adminRoles);
