import type { Profile } from '@repon/types';
import { ProfileNotFoundError } from '../domain/identidad.errors';
import type { ProfileRepository } from '../ports-out/profile-repository.port';
import type { AuditLogPort } from '../../../shared/audit/audit-log.port';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import { SuspenderUsuarioUseCase } from './suspender-usuario.use-case';

const fakeTx = {} as TransactionContext;

function buildDeps() {
  const profileRepository: jest.Mocked<ProfileRepository> = {
    insertIfAbsent: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
  };
  const auditLogPort: jest.Mocked<AuditLogPort> = { record: jest.fn().mockResolvedValue(undefined) };
  const eventPublisher: jest.Mocked<EventPublisher> = { publish: jest.fn().mockResolvedValue(undefined) };
  const transactionManager: jest.Mocked<TransactionManager> = {
    runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)),
  };
  const useCase = new SuspenderUsuarioUseCase(profileRepository, auditLogPort, eventPublisher, transactionManager);
  return { profileRepository, auditLogPort, eventPublisher, transactionManager, useCase };
}

const activeProfile: Profile = {
  id: 'profile-1',
  role: 'user',
  status: 'activo',
  nombre: 'Usuario Uno',
  email: 'u1@example.com',
};

describe('SuspenderUsuarioUseCase', () => {
  it('mutates and audits atomically with motivo carried through, publishes UsuarioSuspendido after commit', async () => {
    const { profileRepository, auditLogPort, eventPublisher, useCase } = buildDeps();
    profileRepository.findById.mockResolvedValue(activeProfile);

    await useCase.execute('profile-1', 'admin-1', 'Fraude reportado');

    expect(profileRepository.update).toHaveBeenCalledWith({ ...activeProfile, status: 'suspendido' }, fakeTx);
    expect(auditLogPort.record).toHaveBeenCalledWith(
      {
        actorProfileId: 'admin-1',
        accion: 'suspender_usuario',
        entityType: 'profile',
        entityId: 'profile-1',
        cambios: { status: { antes: 'activo', despues: 'suspendido' } },
        motivo: 'Fraude reportado',
      },
      fakeTx,
    );
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'usuario.suspendido', profileId: 'profile-1', motivo: 'Fraude reportado' }),
    );
  });

  it('throws ProfileNotFoundError and never mutates/audits/publishes when the profile does not exist', async () => {
    const { profileRepository, auditLogPort, eventPublisher, useCase } = buildDeps();
    profileRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute('missing', 'admin-1', 'motivo')).rejects.toThrow(ProfileNotFoundError);

    expect(profileRepository.update).not.toHaveBeenCalled();
    expect(auditLogPort.record).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('a mutation failure rolls back before any audit entry is written and never publishes', async () => {
    const { profileRepository, auditLogPort, eventPublisher, useCase } = buildDeps();
    profileRepository.findById.mockResolvedValue(activeProfile);
    profileRepository.update.mockRejectedValue(new Error('UPDATE profiles failed'));

    await expect(useCase.execute('profile-1', 'admin-1', 'motivo')).rejects.toThrow('UPDATE profiles failed');

    expect(auditLogPort.record).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });
});
