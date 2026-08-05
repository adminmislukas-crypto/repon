import { Inject, Injectable } from '@nestjs/common';
import { CompanyNotFoundError } from '../domain/identidad.errors';
import { EmpresaAprobada } from '../events/empresa-aprobada.event';
import { COMPANY_REPOSITORY, type CompanyRepository } from '../ports-out/company-repository.port';
import { AUDIT_LOG_PORT, type AuditLogPort } from '../../../shared/audit/audit-log.port';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';

/**
 * `core-api-identidad` spec, "Admin mutations audit inside the same
 * transaction": `companies.status -> 'activo'` and the `audit_log` insert
 * run inside one `TransactionManager.runInTransaction` call sharing the
 * same `tx`; `EmpresaAprobada` publishes only after commit (D-C's
 * transaction map). `findById` first is not just a not-found guard — its
 * result is also the audit entry's `cambios.status.antes` value, and
 * `CompanyRepository.save` is an upsert: calling it blind on a missing id
 * would silently INSERT a bogus row instead of failing loudly.
 */
@Injectable()
export class AprobarEmpresaUseCase {
  constructor(
    @Inject(COMPANY_REPOSITORY) private readonly companyRepository: CompanyRepository,
    @Inject(AUDIT_LOG_PORT) private readonly auditLogPort: AuditLogPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
  ) {}

  async execute(companyId: string, adminId: string): Promise<void> {
    await this.transactionManager.runInTransaction(async (tx) => {
      const company = await this.companyRepository.findById(companyId, tx);
      if (!company) throw new CompanyNotFoundError(companyId);

      const antes = company.status;
      const despues = 'activo' as const;
      await this.companyRepository.save({ ...company, status: despues }, tx);
      await this.auditLogPort.record(
        {
          actorProfileId: adminId,
          accion: 'aprobar_empresa',
          entityType: 'company',
          entityId: companyId,
          cambios: { status: { antes, despues } },
        },
        tx,
      );
    });

    await this.eventPublisher.publish(new EmpresaAprobada(companyId));
  }
}
