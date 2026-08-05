import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AdminRole } from '@repon/types';
import type { AdminRoleAssignment } from '../domain/admin-role-assignment.entity';
import {
  ADMIN_ROLE_REPOSITORY,
  type AdminRoleRepository,
} from '../ports-out/admin-role-repository.port';
import { AUDIT_LOG_PORT, type AuditLogPort } from '../../../shared/audit/audit-log.port';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';

/**
 * `core-api-identidad` spec, "asignarRolAdmin requires the granting admin's
 * id": `adminId` becomes `admin_roles.granted_by` (`NOT NULL`).
 * `AdminRoleRepository.upsert` (`UNIQUE(profile_id)` — a re-grant replaces
 * the row, never duplicates) and the audit write run in the same
 * transaction. No event: `identidad/SPEC.md`'s "Eventos que publica" list
 * does not name one for this use case, and no other domain needs to react
 * to a sub-role change.
 */
@Injectable()
export class AsignarRolAdminUseCase {
  constructor(
    @Inject(ADMIN_ROLE_REPOSITORY) private readonly adminRoleRepository: AdminRoleRepository,
    @Inject(AUDIT_LOG_PORT) private readonly auditLogPort: AuditLogPort,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
  ) {}

  async execute(profileId: string, rol: AdminRole, adminId: string): Promise<void> {
    await this.transactionManager.runInTransaction(async (tx) => {
      const existing = await this.adminRoleRepository.findByProfileId(profileId, tx);

      const assignment: AdminRoleAssignment = {
        id: randomUUID(),
        profileId,
        rol,
        grantedBy: adminId,
        createdAt: new Date().toISOString(),
      };
      await this.adminRoleRepository.upsert(assignment, tx);
      await this.auditLogPort.record(
        {
          actorProfileId: adminId,
          accion: 'asignar_rol_admin',
          entityType: 'admin_role',
          entityId: profileId,
          cambios: { rol: { antes: existing?.rol ?? null, despues: rol } },
        },
        tx,
      );
    });
  }
}
