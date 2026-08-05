import type { Company } from '@repon/types';
import { CompanyNotFoundError } from '../domain/identidad.errors';
import type { CompanyRepository } from '../ports-out/company-repository.port';
import type { AuditLogPort } from '../../../shared/audit/audit-log.port';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import { SuspenderEmpresaUseCase } from './suspender-empresa.use-case';

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
  const useCase = new SuspenderEmpresaUseCase(
    companyRepository,
    auditLogPort,
    eventPublisher,
    transactionManager,
  );
  return { companyRepository, auditLogPort, eventPublisher, transactionManager, useCase };
}

const activeCompany: Company = {
  id: 'company-2',
  razonSocial: 'Otra Proveedora SPA',
  rut: '77.888.999-1',
  giro: 'Refill de agua',
  status: 'activo',
};

describe('SuspenderEmpresaUseCase', () => {
  it('mutates and audits atomically with motivo carried through, publishes EmpresaSuspendida after commit', async () => {
    const { companyRepository, auditLogPort, eventPublisher, useCase } = buildDeps();
    companyRepository.findById.mockResolvedValue(activeCompany);

    await useCase.execute('company-2', 'admin-1', 'Reporte de fraude');

    expect(companyRepository.save).toHaveBeenCalledWith(
      { ...activeCompany, status: 'suspendido' },
      fakeTx,
    );
    expect(auditLogPort.record).toHaveBeenCalledWith(
      {
        actorProfileId: 'admin-1',
        accion: 'suspender_empresa',
        entityType: 'company',
        entityId: 'company-2',
        cambios: { status: { antes: 'activo', despues: 'suspendido' } },
        motivo: 'Reporte de fraude',
      },
      fakeTx,
    );
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'empresa.suspendida',
        companyId: 'company-2',
        motivo: 'Reporte de fraude',
      }),
    );
  });

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
    companyRepository.findById.mockResolvedValue(activeCompany);
    companyRepository.save.mockRejectedValue(new Error('UPDATE companies failed'));

    await expect(useCase.execute('company-2', 'admin-1', 'motivo')).rejects.toThrow(
      'UPDATE companies failed',
    );

    expect(auditLogPort.record).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });
});
