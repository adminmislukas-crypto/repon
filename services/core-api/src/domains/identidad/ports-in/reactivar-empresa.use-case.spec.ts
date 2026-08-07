import type { Company } from '@repon/types';
import { CompanyNotFoundError, CompanyNotSuspendedError } from '../domain/identidad.errors';
import type { CompanyRepository } from '../ports-out/company-repository.port';
import type { AuditLogPort } from '../../../shared/audit/audit-log.port';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import { ReactivarEmpresaUseCase } from './reactivar-empresa.use-case';

const fakeTx = {} as TransactionContext;

function buildDeps() {
  const companyRepository: jest.Mocked<CompanyRepository> = {
    save: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
  };
  const auditLogPort: jest.Mocked<AuditLogPort> = {
    record: jest.fn().mockResolvedValue(undefined),
  };
  const eventPublisher: jest.Mocked<EventPublisher> = {
    publish: jest.fn().mockResolvedValue(undefined),
  };
  const transactionManager: jest.Mocked<TransactionManager> = {
    runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)),
  };
  const useCase = new ReactivarEmpresaUseCase(
    companyRepository,
    auditLogPort,
    eventPublisher,
    transactionManager,
  );
  return { companyRepository, auditLogPort, eventPublisher, transactionManager, useCase };
}

const suspendedCompany: Company = {
  id: 'company-2',
  razonSocial: 'Otra Proveedora SPA',
  rut: '77.888.999-1',
  giro: 'Refill de agua',
  status: 'suspendido',
};

describe('ReactivarEmpresaUseCase', () => {
  it('mutates and audits atomically with motivo carried through, publishes EmpresaReactivada after commit', async () => {
    const { companyRepository, auditLogPort, eventPublisher, useCase } = buildDeps();
    companyRepository.findById.mockResolvedValue(suspendedCompany);

    await useCase.execute('company-2', 'admin-1', 'Cumplió con el plan de mejora');

    expect(companyRepository.save).toHaveBeenCalledWith(
      { ...suspendedCompany, status: 'activo' },
      fakeTx,
    );
    expect(auditLogPort.record).toHaveBeenCalledWith(
      {
        actorProfileId: 'admin-1',
        accion: 'reactivar_empresa',
        entityType: 'company',
        entityId: 'company-2',
        cambios: { status: { antes: 'suspendido', despues: 'activo' } },
        motivo: 'Cumplió con el plan de mejora',
      },
      fakeTx,
    );
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'empresa.reactivada',
        companyId: 'company-2',
        motivo: 'Cumplió con el plan de mejora',
      }),
    );
  });

  it.each([['activo'], ['pendiente']] as const)(
    'throws CompanyNotSuspendedError and never mutates/audits/publishes when status is %s',
    async (status) => {
      const { companyRepository, auditLogPort, eventPublisher, useCase } = buildDeps();
      companyRepository.findById.mockResolvedValue({ ...suspendedCompany, status });

      await expect(useCase.execute('company-2', 'admin-1', 'motivo')).rejects.toThrow(
        CompanyNotSuspendedError,
      );

      expect(companyRepository.save).not.toHaveBeenCalled();
      expect(auditLogPort.record).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    },
  );

  it('throws CompanyNotFoundError and never mutates/audits/publishes when the company does not exist', async () => {
    const { companyRepository, auditLogPort, eventPublisher, useCase } = buildDeps();
    companyRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute('missing', 'admin-1', 'motivo')).rejects.toThrow(
      CompanyNotFoundError,
    );

    expect(companyRepository.save).not.toHaveBeenCalled();
    expect(auditLogPort.record).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('a mutation failure rolls back before any audit entry is written and never publishes', async () => {
    const { companyRepository, auditLogPort, eventPublisher, useCase } = buildDeps();
    companyRepository.findById.mockResolvedValue(suspendedCompany);
    companyRepository.save.mockRejectedValue(new Error('UPDATE companies failed'));

    await expect(useCase.execute('company-2', 'admin-1', 'motivo')).rejects.toThrow(
      'UPDATE companies failed',
    );

    expect(auditLogPort.record).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });
});
