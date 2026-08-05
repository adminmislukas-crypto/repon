import type { AdminRoleAssignment } from '../domain/admin-role-assignment.entity';
import type { TransactionContext } from '../../../shared/database/transaction';

// core-api-identidad spec, "Falta AdminRoleRepository" delta — closes the
// gap: `asignarRolAdmin` (Phase 4b) has no port to write `admin_roles`
// without this.
export interface AdminRoleRepository {
  /** `UNIQUE(profile_id)` — a re-grant replaces the existing row, never duplicates. */
  upsert(assignment: AdminRoleAssignment, tx?: TransactionContext): Promise<void>;
  findByProfileId(profileId: string, tx?: TransactionContext): Promise<AdminRoleAssignment | null>;
}

export const ADMIN_ROLE_REPOSITORY = Symbol('ADMIN_ROLE_REPOSITORY');
