import { Inject, Injectable } from '@nestjs/common';
import { CompanyNotFoundError, CompanyNotSuspendedError } from '../domain/identidad.errors';
import { EmpresaReactivada } from '../events/empresa-reactivada.event';
import { COMPANY_REPOSITORY, type CompanyRepository } from '../ports-out/company-repository.port';
import { AUDIT_LOG_PORT, type AuditLogPort } from '../../../shared/audit/audit-log.port';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';

/**
 * `core-api-identidad` spec, "reactivarEmpresa reverses a suspension,
 * audited in the same transaction" (D16/D-D, `backend-core-api-catalogo`).
 * Exact mirror of `SuspenderEmpresaUseCase` — same 4 injected ports, same
 * `runInTransaction { findById → save → auditLogPort.record }` shape,
 * `publish` after commit — with ONE deliberate difference: the destination
 * state (`activo`) is permissive, not restrictive, so this use case
 * requires `company.status === 'suspendido'` as a precondition and throws
 * `CompanyNotSuspendedError` (409) before any write if it isn't. Without
 * this guard, reactivating a `pendiente` company would activate it while
 * skipping `aprobarEmpresa`'s approval step and leaving an audit trail that
 * misrepresents what happened.
 */
@Injectable()
export class ReactivarEmpresaUseCase {
  constructor(
    @Inject(COMPANY_REPOSITORY) private readonly companyRepository: CompanyRepository,
    @Inject(AUDIT_LOG_PORT) private readonly auditLogPort: AuditLogPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
  ) {}

  async execute(companyId: string, adminId: string, motivo: string): Promise<void> {
    await this.transactionManager.runInTransaction(async (tx) => {
      const company = await this.companyRepository.findById(companyId, tx);
      if (!company) throw new CompanyNotFoundError(companyId);
      if (company.status !== 'suspendido') throw new CompanyNotSuspendedError(companyId);

      const antes = company.status;
      const despues = 'activo' as const;
      await this.companyRepository.save({ ...company, status: despues }, tx);
      await this.auditLogPort.record(
        {
          actorProfileId: adminId,
          accion: 'reactivar_empresa',
          entityType: 'company',
          entityId: companyId,
          cambios: { status: { antes, despues } },
          motivo,
        },
        tx,
      );
    });

    await this.eventPublisher.publish(new EmpresaReactivada(companyId, motivo));
  }
}
