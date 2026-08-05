import type { AdminRole } from '@repon/types';

/**
 * Named distinctly from `@repon/types`' `AdminRole` union (the sub-role
 * enum) — core-api-identidad spec resolves the naming collision
 * `identidad/SPEC.md` left open ("AdminRole" listed as both an owned
 * entity and an enum).
 */
export interface AdminRoleAssignment {
  id: string;
  profileId: string;
  rol: AdminRole;
  grantedBy: string;
  createdAt: string;
}
