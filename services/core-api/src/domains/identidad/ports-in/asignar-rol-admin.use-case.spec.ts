import type { AdminRoleAssignment } from '../domain/admin-role-assignment.entity';
import type { AdminRoleRepository } from '../ports-out/admin-role-repository.port';
import type { AuditLogPort } from '../../../shared/audit/audit-log.port';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import { AsignarRolAdminUseCase } from './asignar-rol-admin.use-case';

const fakeTx = {} as TransactionContext;

function buildDeps() {
  const adminRoleRepository: jest.Mocked<AdminRoleRepository> = {
    upsert: jest.fn().mockResolvedValue(undefined),
    findByProfileId: jest.fn(),
  };
  const auditLogPort: jest.Mocked<AuditLogPort> = {
    record: jest.fn().mockResolvedValue(undefined),
  };
  const transactionManager: jest.Mocked<TransactionManager> = {
    runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)),
  };
  const useCase = new AsignarRolAdminUseCase(adminRoleRepository, auditLogPort, transactionManager);
  return { adminRoleRepository, auditLogPort, useCase };
}

describe('AsignarRolAdminUseCase', () => {
  it('grants a first sub-role: upserts + audits with antes: null in the same transaction, no event', async () => {
    const { adminRoleRepository, auditLogPort, useCase } = buildDeps();
    adminRoleRepository.findByProfileId.mockResolvedValue(null);

    await useCase.execute('profile-1', 'soporte', 'admin-1');

    expect(adminRoleRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'profile-1', rol: 'soporte', grantedBy: 'admin-1' }),
      fakeTx,
    );
    expect(auditLogPort.record).toHaveBeenCalledWith(
      {
        actorProfileId: 'admin-1',
        accion: 'asignar_rol_admin',
        entityType: 'admin_role',
        entityId: 'profile-1',
        cambios: { rol: { antes: null, despues: 'soporte' } },
      },
      fakeTx,
    );
  });

  it('re-assigning a sub-role replaces, not duplicates: upsert receives the same profileId, audit records antes/despues', async () => {
    const { adminRoleRepository, auditLogPort, useCase } = buildDeps();
    const existing: AdminRoleAssignment = {
      id: 'role-row-1',
      profileId: 'profile-1',
      rol: 'soporte',
      grantedBy: 'admin-0',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    adminRoleRepository.findByProfileId.mockResolvedValue(existing);

    await useCase.execute('profile-1', 'finanzas', 'admin-1');

    expect(adminRoleRepository.upsert).toHaveBeenCalledTimes(1);
    const [assignment] = adminRoleRepository.upsert.mock.calls[0];
    expect(assignment.profileId).toBe('profile-1');
    expect(assignment.rol).toBe('finanzas');
    expect(assignment.grantedBy).toBe('admin-1');

    expect(auditLogPort.record).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'asignar_rol_admin',
        cambios: { rol: { antes: 'soporte', despues: 'finanzas' } },
      }),
      fakeTx,
    );
  });
});
