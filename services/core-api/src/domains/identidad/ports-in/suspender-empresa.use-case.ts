import { Inject, Injectable } from '@nestjs/common';
import { CompanyNotFoundError } from '../domain/identidad.errors';
import { EmpresaSuspendida } from '../events/empresa-suspendida.event';
import { COMPANY_REPOSITORY, type CompanyRepository } from '../ports-out/company-repository.port';
import { AUDIT_LOG_PORT, type AuditLogPort } from '../../../shared/audit/audit-log.port';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';

/**
 * `core-api-identidad` spec, "suspenderUsuario / suspenderEmpresa mirror the
 * same pattern": mutation + `AuditLogPort.record` (with `motivo` carried
 * through as the entry's top-level `motivo`, not inside `cambios`) inside
 * one transaction; `EmpresaSuspendida` publishes after commit.
 */
@Injectable()
export class SuspenderEmpresaUseCase {
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

      const antes = company.status;
      const despues = 'suspendido' as const;
      await this.companyRepository.save({ ...company, status: despues }, tx);
      await this.auditLogPort.record(
        {
          actorProfileId: adminId,
          accion: 'suspender_empresa',
          entityType: 'company',
          entityId: companyId,
          cambios: { status: { antes, despues } },
          motivo,
        },
        tx,
      );
    });

    await this.eventPublisher.publish(new EmpresaSuspendida(companyId, motivo));
  }
}
