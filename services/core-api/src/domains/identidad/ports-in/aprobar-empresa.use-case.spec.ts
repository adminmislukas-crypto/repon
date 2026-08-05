import type { Company } from '@repon/types';
import { CompanyNotFoundError } from '../domain/identidad.errors';
import type { CompanyRepository } from '../ports-out/company-repository.port';
import type { AuditLogPort } from '../../../shared/audit/audit-log.port';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import { AprobarEmpresaUseCase } from './aprobar-empresa.use-case';

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
  const useCase = new AprobarEmpresaUseCase(
    companyRepository,
    auditLogPort,
    eventPublisher,
    transactionManager,
  );
  return { companyRepository, auditLogPort, eventPublisher, transactionManager, useCase };
}

const pendingCompany: Company = {
  id: 'company-1',
  razonSocial: 'Proveedora SPA',
  rut: '76.123.456-7',
  giro: 'Distribución de agua',
  status: 'pendiente',
};

describe('AprobarEmpresaUseCase', () => {
  it('mutates and audits atomically inside one transaction, then publishes EmpresaAprobada after commit', async () => {
    const { companyRepository, auditLogPort, eventPublisher, useCase } = buildDeps();
    companyRepository.findById.mockResolvedValue(pendingCompany);

    await useCase.execute('company-1', 'admin-1');

    expect(companyRepository.save).toHaveBeenCalledWith(
      { ...pendingCompany, status: 'activo' },
      fakeTx,
    );
    expect(auditLogPort.record).toHaveBeenCalledWith(
      {
        actorProfileId: 'admin-1',
        accion: 'aprobar_empresa',
        entityType: 'company',
        entityId: 'company-1',
        cambios: { status: { antes: 'pendiente', despues: 'activo' } },
      },
      fakeTx,
    );
    // `save` and `record` must both receive the SAME tx passed into `runInTransaction`'s callback.
    const saveOrder = companyRepository.save.mock.invocationCallOrder[0];
    const recordOrder = auditLogPort.record.mock.invocationCallOrder[0];
    const publishOrder = eventPublisher.publish.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(recordOrder);
    expect(recordOrder).toBeLessThan(publishOrder);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'empresa.aprobada', companyId: 'company-1' }),
    );
  });

  it('throws CompanyNotFoundError and never mutates/audits/publishes when the company does not exist', async () => {
    const { companyRepository, auditLogPort, eventPublisher, useCase } = buildDeps();
    companyRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute('missing', 'admin-1')).rejects.toThrow(CompanyNotFoundError);

    expect(companyRepository.save).not.toHaveBeenCalled();
    expect(auditLogPort.record).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('a mutation failure rolls back before any audit entry is written and never publishes', async () => {
    const { companyRepository, auditLogPort, eventPublisher, transactionManager, useCase } =
      buildDeps();
    companyRepository.findById.mockResolvedValue(pendingCompany);
    companyRepository.save.mockRejectedValue(new Error('UPDATE companies failed'));

    await expect(useCase.execute('company-1', 'admin-1')).rejects.toThrow(
      'UPDATE companies failed',
    );

    expect(transactionManager.runInTransaction).toHaveBeenCalledTimes(1);
    expect(auditLogPort.record).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });
});
